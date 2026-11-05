import { randomUUID } from 'node:crypto';

/**
 * Único lugar com SQL (ADR-0005, ADR-0011). Só acesso às duas tabelas: nada de
 * regra de negócio aqui — bloqueio, captcha e ordem do login ficam no
 * authService, que é testável sem banco de verdade.
 *
 * As consultas são preparadas uma vez e reusadas; `DatabaseSync` é síncrono.
 */
export function createUsersService({ db }) {
  const statements = {
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, failed_count, locked_until)
       VALUES (?, ?, ?, ?, 0, NULL)`
    ),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    setLock: db.prepare(
      'UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?'
    ),
    insertSession: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ),
    findSession: db.prepare(
      `SELECT u.id, u.email, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  return {
    /** Linha crua de `users`, ou undefined. O e-mail já deve vir em minúsculas. */
    findByEmail(email) {
      return statements.findByEmail.get(email);
    },

    /** Cria a conta e devolve `{ id, email }`. O UNIQUE de email lança se repetir. */
    create({ email, passwordHash, createdAt }) {
      const id = randomUUID();
      statements.insertUser.run(id, email, passwordHash, createdAt);
      return { id, email };
    },

    /** Apaga a conta; as sessões vão com ela, por ON DELETE CASCADE. */
    remove(userId) {
      return statements.deleteUser.run(userId).changes > 0;
    },

    /** Grava o contador de erros e o fim do bloqueio (ISO 8601 ou null). */
    setLockState(userId, { failedCount, lockedUntil }) {
      statements.setLock.run(failedCount, lockedUntil ?? null, userId);
    },

    createSession({ tokenHash, userId, createdAt, expiresAt }) {
      statements.insertSession.run(tokenHash, userId, createdAt, expiresAt);
    },

    /** Sessão com os dados do usuário, sem olhar a validade. */
    findSession(tokenHash) {
      return statements.findSession.get(tokenHash);
    },

    removeSession(tokenHash) {
      return statements.deleteSession.run(tokenHash).changes > 0;
    },

    /** Faxina das sessões vencidas; roda junto da validação de token. */
    removeExpiredSessions(nowIso) {
      return statements.deleteExpiredSessions.run(nowIso).changes;
    },
  };
}
