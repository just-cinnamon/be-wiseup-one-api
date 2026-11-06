import { createHash, randomBytes } from 'node:crypto';
import {
  invalidCredentials,
  invalidParams,
  tooManyAttempts,
  unauthorized,
  captchaFailed,
} from '../http/errors.js';
import { fakeVerify, hash, verify } from './password.js';

// Validação por lista de valores permitidos, como manda a ADR-0007.
const EMAIL_PATTERN =
  /^[a-z0-9][a-z0-9._%+-]{0,62}@[a-z0-9][a-z0-9.-]{0,62}\.[a-z]{2,24}$/;
const EMAIL_MAX = 160;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 200;
const CAPTCHA_MAX = 4000;
const TOKEN_MIN = 20;
const TOKEN_MAX = 200;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const SESSION_TOKEN_BYTES = 32;

/**
 * Regras de login, sessão e bloqueio — sem nada de Express (ADR-0005).
 * Nos testes recebe um `users` falso, um captcha falso e um relógio fixo.
 *
 * `captchaRequired` vem de fora (ADR-0014): o token do reCAPTCHA só é exigido
 * quando existe RECAPTCHA_SECRET para conferi-lo. Sem secret, exigir um token
 * que ninguém verifica seria teatro, e recusar todo login deixaria o site
 * inacessível. Nos dois casos, quem segura força bruta é o bloqueio por conta.
 */
export function createAuthService({
  users,
  captchaService,
  captchaRequired = false,
  sessionTtlHours = 12,
  maxAttempts = 5,
  lockMinutes = 15,
  now = () => new Date(),
}) {
  /**
   * Confere o formato dos três campos antes de qualquer trabalho caro.
   * Mensagem genérica de propósito: "e-mail inválido" aqui não diz nada sobre
   * quem tem conta, porque nem chegou perto do banco.
   */
  function parseCredentials(body = {}) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : '';

    if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))
      throw invalidParams('Informe um e-mail válido.');
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
      throw invalidParams(
        `A senha deve ter de ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres.`
      );
    // O comprimento máximo vale sempre: campo grande no corpo é entrada
    // hostil, mesmo com o captcha desligado.
    if (captchaToken.length > CAPTCHA_MAX || (captchaRequired && !captchaToken))
      throw invalidParams('Confirme que você não é um robô.');

    return { email, password, captchaToken };
  }

  /** Cria a sessão e devolve o token em claro — que só o front vai ter. */
  async function startSession(user, current) {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      current.getTime() + sessionTtlHours * 60 * 60 * 1000
    ).toISOString();

    await users.createSession({
      tokenHash: sha256(token),
      userId: user.id,
      createdAt: current.toISOString(),
      expiresAt,
    });

    return {
      // O front usa `ageVerified` para mandar direto a quem falta verificar,
      // sem esperar o primeiro 403 do catálogo.
      user: {
        id: user.id,
        email: user.email,
        ageVerified: Boolean(user.age_verified_at),
      },
      token,
      expiresAt,
    };
  }

  return {
    /**
     * A ordem importa e está na ADR-0011: formato, captcha, bloqueio, senha.
     * O captcha vem antes da senha para que força bruta não chegue de graça ao
     * `scrypt`, que é a parte caríssima.
     */
    async login(body) {
      const { email, password, captchaToken } = parseCredentials(body);

      if (captchaRequired && !(await captchaService.verify(captchaToken)))
        throw captchaFailed();

      const current = now();
      const user = await users.findByEmail(email);

      if (!user) {
        // Gasta o tempo de um scrypt para o relógio não revelar que este
        // e-mail não existe. A mensagem é a mesma de senha errada.
        await fakeVerify(password);
        throw invalidCredentials();
      }

      const lockedUntil = user.locked_until ? new Date(user.locked_until) : null;
      if (lockedUntil && lockedUntil > current) throw tooManyAttempts(lockMinutes);

      // Bloqueio vencido zera o contador: as cinco tentativas são por janela.
      const failedBefore = lockedUntil ? 0 : Number(user.failed_count) || 0;

      if (!(await verify(password, user.password_hash))) {
        const failedCount = failedBefore + 1;
        const reachedLimit = failedCount >= maxAttempts;
        await users.setLockState(user.id, {
          failedCount,
          lockedUntil: reachedLimit
            ? new Date(current.getTime() + lockMinutes * 60 * 1000).toISOString()
            : null,
        });
        throw reachedLimit ? tooManyAttempts(lockMinutes) : invalidCredentials();
      }

      if (failedBefore > 0 || lockedUntil)
        await users.setLockState(user.id, { failedCount: 0, lockedUntil: null });

      return startSession(user, current);
    },

    /** Token do header vira `{ id, email }`, ou 401. Usado pelo requireAuth. */
    async getSessionUser(token) {
      if (
        typeof token !== 'string' ||
        token.length < TOKEN_MIN ||
        token.length > TOKEN_MAX
      )
        throw unauthorized('Sessão inválida. Entre novamente.');

      const nowIso = now().toISOString();
      await users.removeExpiredSessions(nowIso);

      const session = await users.findSession(sha256(token));
      if (!session || session.expires_at <= nowIso) throw unauthorized();

      // `ageVerified` vai na sessão para o `requireAdult` decidir sem outra
      // consulta. Campo ausente ou nulo é "não verificado" (ADR-0015).
      return {
        id: session.id,
        email: session.email,
        ageVerified: Boolean(session.age_verified_at),
      };
    },

    /** Apaga a linha em `sessions`: é o que um JWT não permitiria. */
    async logout(token) {
      if (typeof token !== 'string') return false;
      return users.removeSession(sha256(token));
    },

    /** Apaga a conta e, por cascata, as sessões. Requisito de LGPD. */
    async deleteAccount(userId) {
      return users.remove(userId);
    },

    /**
     * Semeia as contas de `SEED_USERS` no boot, sem repetir o que já existe.
     * É o que mantém o login funcionando no Render, onde o disco é efêmero.
     * Não registra e-mail em log, só a quantidade.
     */
    async seedUsers(entries = []) {
      let created = 0;
      for (const entry of entries) {
        if (await users.findByEmail(entry.email)) continue;
        await users.create({
          email: entry.email,
          passwordHash: await hash(entry.password),
          createdAt: now().toISOString(),
        });
        created += 1;
      }
      return created;
    },
  };
}
