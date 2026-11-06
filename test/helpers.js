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
  const acceptances = [];

  const store = {
    byId,
    sessions,
    acceptances,

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
        // Verificação de idade (ADR-0015): nasce sem nada verificado.
        age_verified_at: null,
        age_method: null,
        age_ref: null,
      };
      byId.set(user.id, user);
      return { id: user.id, email: user.email };
    },

    async remove(userId) {
      // ON DELETE CASCADE, à mão: sessões e aceites vão com a conta.
      for (const [hash, session] of sessions)
        if (session.user_id === userId) sessions.delete(hash);
      for (let i = acceptances.length - 1; i >= 0; i -= 1)
        if (acceptances[i].user_id === userId) acceptances.splice(i, 1);
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

    async findById(userId) {
      return byId.get(userId);
    },

    async findSession(tokenHash, versions) {
      const session = sessions.get(tokenHash);
      if (!session) return undefined;
      const user = byId.get(session.user_id);
      if (!user) return undefined;
      // Mesma contagem da subconsulta do SQL de verdade (ADR-0016): quantos
      // dos documentos vigentes esta conta já aceitou.
      const accepted = acceptances.filter(
        (a) => a.user_id === user.id && versions?.[a.document] === a.version
      ).length;
      return {
        id: user.id,
        email: user.email,
        age_verified_at: user.age_verified_at,
        expires_at: session.expires_at,
        accepted_count: accepted,
      };
    },

    // ---- Verificação de idade (ADR-0015) ----

    async setAgeRef(userId, { ref, method }) {
      const user = byId.get(userId);
      if (!user) return;
      user.age_ref = ref;
      user.age_method = method ?? user.age_method;
    },

    async findByAgeRef(ref) {
      return [...byId.values()].find((u) => u.age_ref === ref);
    },

    async setAgeVerified({ ref, verifiedAt, method }) {
      const user = [...byId.values()].find(
        (u) => u.age_ref === ref && !u.age_verified_at
      );
      if (!user) return false;
      user.age_verified_at = verifiedAt;
      user.age_method = method ?? user.age_method;
      return true;
    },

    async removeSession(tokenHash) {
      return sessions.delete(tokenHash);
    },

    // ---- Aceite de termos (ADR-0016) ----

    async acceptTerms({ userId, document, version, acceptedAt }) {
      const jaTem = acceptances.some(
        (a) => a.user_id === userId && a.document === document && a.version === version
      );
      // ON CONFLICT DO NOTHING: a data que vale é a do primeiro aceite.
      if (!jaTem) {
        acceptances.push({
          user_id: userId,
          document,
          version,
          accepted_at: acceptedAt,
        });
      }
    },

    async listAcceptances(userId) {
      return acceptances
        .filter((a) => a.user_id === userId)
        .map(({ document, version, accepted_at }) => ({ document, version, accepted_at }))
        .reverse();
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
