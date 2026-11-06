import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Cliente falso que responde com as fixtures e registra as chamadas. */
export function fakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    search: async (params) => (calls.push(['search', params]), fixture('search')),
    videoById: async (id) => (calls.push(['videoById', id]), fixture('video_by_id')),
    categories: async () => fixture('categories'),
    ...overrides,
  };
}

/**
 * `usersService` falso, em memória, com o mesmo contrato assíncrono do real
 * (ADR-0005: o authService recebe `users` por parâmetro). Existe porque o banco
 * virou Postgres (ADR-0013) e as regras de login não devem precisar de um
 * servidor de banco para serem testadas — o SQL de verdade é coberto por
 * `usersService.test.js`, que só roda com TEST_DATABASE_URL.
 *
 * Os mapas ficam expostos para os testes conferirem o que foi guardado (por
 * exemplo: que a sessão guarda o sha256 do token, e não o token).
 */
export function fakeUsers() {
  let seq = 0;
  const byId = new Map();
  const sessions = new Map();

  const store = {
    byId,
    sessions,

    async findByEmail(email) {
      return [...byId.values()].find((u) => u.email === email);
    },

    async create({ email, passwordHash, createdAt }) {
      if (await store.findByEmail(email)) throw new Error('email duplicado');
      seq += 1;
      const user = {
        id: `u${seq}`,
        email,
        password_hash: passwordHash,
        created_at: createdAt,
        failed_count: 0,
        locked_until: null,
      };
      byId.set(user.id, user);
      return { id: user.id, email: user.email };
    },

    async remove(userId) {
      // ON DELETE CASCADE, à mão: as sessões vão com a conta.
      for (const [hash, session] of sessions)
        if (session.user_id === userId) sessions.delete(hash);
      return byId.delete(userId);
    },

    async setLockState(userId, { failedCount, lockedUntil }) {
      const user = byId.get(userId);
      if (!user) return;
      user.failed_count = failedCount;
      user.locked_until = lockedUntil ?? null;
    },

    async createSession({ tokenHash, userId, createdAt, expiresAt }) {
      sessions.set(tokenHash, {
        user_id: userId,
        created_at: createdAt,
        expires_at: expiresAt,
      });
    },

    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return undefined;
      const user = byId.get(session.user_id);
      if (!user) return undefined;
      return { id: user.id, email: user.email, expires_at: session.expires_at };
    },

    async removeSession(tokenHash) {
      return sessions.delete(tokenHash);
    },

    async removeExpiredSessions(nowIso) {
      let removed = 0;
      for (const [hash, session] of sessions) {
        if (session.expires_at <= nowIso) {
          sessions.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },
  };

  return store;
}
