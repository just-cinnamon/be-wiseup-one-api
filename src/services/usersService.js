import { randomUUID } from 'node:crypto';

/**
 * Único lugar com SQL (ADR-0005, ADR-0013). Só acesso às tabelas: nada de
 * regra de negócio aqui — bloqueio, captcha e ordem do login ficam no
 * authService, que é testável sem banco nenhum.
 *
 * Todo método é assíncrono: o driver do Postgres é assíncrono, diferente do
 * `node:sqlite` que havia antes. Quem chama precisa de `await`.
 */
export function createUsersService({ db }) {
  return {
    /** Linha crua de `users`, ou undefined. O e-mail já deve vir em minúsculas. */
    async findByEmail(email) {
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      return rows[0];
    },

    /** Cria a conta e devolve `{ id, email }`. O UNIQUE de email lança se repetir. */
    async create({ email, passwordHash, createdAt }) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO users (id, email, password_hash, created_at, failed_count, locked_until)
         VALUES ($1, $2, $3, $4, 0, NULL)`,
        [id, email, passwordHash, createdAt]
      );
      return { id, email };
    },

    /** Apaga a conta; as sessões vão com ela, por ON DELETE CASCADE. */
    async remove(userId) {
      const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [userId]);
      return rowCount > 0;
    },

    /** Grava o contador de erros e o fim do bloqueio (ISO 8601 ou null). */
    async setLockState(userId, { failedCount, lockedUntil }) {
      await db.query(
        'UPDATE users SET failed_count = $1, locked_until = $2 WHERE id = $3',
        [failedCount, lockedUntil ?? null, userId]
      );
    },

    async createSession({ tokenHash, userId, createdAt, expiresAt }) {
      await db.query(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [tokenHash, userId, createdAt, expiresAt]
      );
    },

    /** Linha crua de `users` por id, ou undefined. */
    async findById(userId) {
      const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      return rows[0];
    },

    /**
     * Sessão com os dados do usuário, sem olhar a validade.
     *
     * Traz `age_verified_at` e a contagem de aceites da versão vigente numa
     * consulta só: `requireAdult` e `requireTerms` decidem por requisição, e
     * três idas ao banco por chamada autenticada não se justificam.
     *
     * @param {string} tokenHash
     * @param {{ termos: string, privacidade: string }} versions versões
     *   vigentes dos documentos (`config/legal.js`)
     */
    async findSession(tokenHash, versions) {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.age_verified_at, s.expires_at,
                (SELECT COUNT(*) FROM terms_acceptances ta
                  WHERE ta.user_id = u.id
                    AND ((ta.document = 'termos' AND ta.version = $2)
                      OR (ta.document = 'privacidade' AND ta.version = $3))
                ) AS accepted_count
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1`,
        [tokenHash, versions?.termos ?? '', versions?.privacidade ?? '']
      );
      return rows[0];
    },

    async removeSession(tokenHash) {
      const { rowCount } = await db.query('DELETE FROM sessions WHERE token_hash = $1', [
        tokenHash,
      ]);
      return rowCount > 0;
    },

    // ---- Verificação de idade (ADR-0015) ----

    /**
     * Guarda a referência da verificação em andamento. Não verifica nada: só
     * anota qual identificação do provedor pertence a esta conta, para o
     * webhook saber de quem está falando.
     */
    async setAgeRef(userId, { ref, method }) {
      await db.query('UPDATE users SET age_ref = $1, age_method = $2 WHERE id = $3', [
        ref,
        method ?? null,
        userId,
      ]);
    },

    /** Conta cuja verificação em andamento tem esta referência. */
    async findByAgeRef(ref) {
      const { rows } = await db.query('SELECT * FROM users WHERE age_ref = $1', [ref]);
      return rows[0];
    },

    /**
     * Marca a idade como verificada. Guarda **só** quando, como e o ID no
     * provedor — nunca documento, foto, CPF ou data de nascimento.
     */
    async setAgeVerified({ ref, verifiedAt, method }) {
      const { rowCount } = await db.query(
        `UPDATE users SET age_verified_at = $1, age_method = COALESCE($2, age_method)
          WHERE age_ref = $3 AND age_verified_at IS NULL`,
        [verifiedAt, method ?? null, ref]
      );
      return rowCount > 0;
    },

    // ---- Aceite de termos (ADR-0016) ----

    /**
     * Grava o aceite de uma versão. Idempotente: aceitar duas vezes a mesma
     * versão não cria linha nova nem muda a data do primeiro aceite — a data
     * que importa é a do aceite original.
     */
    async acceptTerms({ userId, document, version, acceptedAt }) {
      await db.query(
        `INSERT INTO terms_acceptances (user_id, document, version, accepted_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, document, version) DO NOTHING`,
        [userId, document, version, acceptedAt]
      );
    },

    /** Todos os aceites da conta, do mais recente para o mais antigo. */
    async listAcceptances(userId) {
      const { rows } = await db.query(
        `SELECT document, version, accepted_at
           FROM terms_acceptances
          WHERE user_id = $1
          ORDER BY accepted_at DESC`,
        [userId]
      );
      return rows;
    },

    /** Faxina das sessões vencidas; roda junto da validação de token. */
    async removeExpiredSessions(nowIso) {
      const { rowCount } = await db.query('DELETE FROM sessions WHERE expires_at <= $1', [
        nowIso,
      ]);
      return rowCount;
    },
  };
}
