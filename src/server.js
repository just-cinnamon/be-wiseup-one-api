// Primeiro import de propósito: confere a versão do Node antes de carregar o
// Express, que não funciona em versões antigas.
import './config/checkNode.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { LEGAL_VERSIONS } from './config/legal.js';
import { createDatabase } from './db/database.js';
import { createAgeService } from './services/ageService.js';
import { createAuthService } from './services/authService.js';
import { createCache } from './services/cache.js';
import { createCaptchaService } from './services/captchaService.js';
import { createPornhubClient } from './services/pornhubClient.js';
import { createUsersService } from './services/usersService.js';
import { createVideosService } from './services/videosService.js';

const cache = createCache({ ttlSeconds: env.cacheTtlSeconds });
const client = createPornhubClient({
  baseUrl: env.upstreamBaseUrl,
  timeoutMs: env.upstreamTimeoutMs,
  cache,
});
const videosService = createVideosService({ client });

// Banco (ADR-0013) e autenticação (ADR-0011).
const db = createDatabase({
  connectionString: env.databaseUrl,
  sslInsecure: env.databaseSslInsecure,
});
await db.applySchema();

const users = createUsersService({ db });
const captchaService = createCaptchaService({
  secret: env.recaptchaSecret,
  timeoutMs: env.upstreamTimeoutMs,
  isProduction: env.isProduction,
});

// O captcha só é exigido quando há secret para conferi-lo (ADR-0014). Sem ele,
// o aviso é alto de propósito: a única barreira contra força bruta passa a ser
// o bloqueio por conta.
const captchaRequired = Boolean(env.recaptchaSecret);
if (!captchaRequired) {
  console.warn(
    `AVISO: sem RECAPTCHA_SECRET, o login não pede captcha. Força bruta é contida só pelo bloqueio por conta (${env.loginMaxAttempts} tentativas, ${env.loginLockMinutes} min).`
  );
}

const authService = createAuthService({
  users,
  captchaService,
  captchaRequired,
  legalVersions: LEGAL_VERSIONS,
  sessionTtlHours: env.sessionTtlHours,
  maxAttempts: env.loginMaxAttempts,
  lockMinutes: env.loginLockMinutes,
});

// As contas de SEED_USERS continuam sendo criadas no boot, agora só para o
// banco nascer utilizável — com Postgres elas sobrevivem ao deploy (ADR-0013).
// O log conta quantas contas entraram, nunca quais.
const created = await authService.seedUsers(env.seedUsers);
console.log(
  `Banco conectado: ${env.seedUsers.length} conta(s) em SEED_USERS, ${created} criada(s) agora.`
);

// Verificação de idade (ADR-0015). O construtor já avisa no boot quando não há
// provedor cadastrado, ou quando o atalho de desenvolvimento está ligado.
const ageService = createAgeService({
  providerUrl: env.ageProviderUrl,
  providerKey: env.ageProviderKey,
  webhookSecret: env.ageWebhookSecret,
  isProduction: env.isProduction,
  devAutoVerify: env.ageDevAutoVerify,
  timeoutMs: env.upstreamTimeoutMs,
});

const app = createApp({
  videosService,
  authService,
  ageService,
  users,
  legalVersions: LEGAL_VERSIONS,
  corsOrigins: env.corsOrigins,
});

app.listen(env.port, () => {
  console.log(`API rodando em http://localhost:${env.port}/api`);
});

// Fecha o banco no encerramento, para o WAL não ficar com escrita pendente.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await db.close();
    process.exit(0);
  });
}
