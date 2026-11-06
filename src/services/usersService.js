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

    /** Sessão com os dados do usuário, sem olhar a validade. */
    async findSession(tokenHash) {
      const { rows } = await db.query(
        `SELECT u.id, u.email, s.expires_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1`,
        [tokenHash]
      );
      return rows[0];
    },

    async removeSession(tokenHash) {
      const { rowCount } = await db.query('DELETE FROM sessions WHERE token_hash = $1', [
        tokenHash,
      ]);
      return rowCount > 0;
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
