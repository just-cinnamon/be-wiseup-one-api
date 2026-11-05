// Primeiro import de propósito: confere a versão do Node antes de carregar o
// Express, que não funciona em versões antigas.
import './config/checkNode.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { openDatabase } from './db/database.js';
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

// Autenticação (ADR-0011).
const db = openDatabase(env.databaseFile);
const users = createUsersService({ db });
const captchaService = createCaptchaService({
  secret: env.recaptchaSecret,
  timeoutMs: env.upstreamTimeoutMs,
  isProduction: env.isProduction,
});
const authService = createAuthService({
  users,
  captchaService,
  sessionTtlHours: env.sessionTtlHours,
  maxAttempts: env.loginMaxAttempts,
  lockMinutes: env.loginLockMinutes,
});

// O disco do Render é efêmero: sem semear no boot, o login morre a cada deploy.
// O log conta quantas contas entraram, nunca quais.
const created = await authService.seedUsers(env.seedUsers);
console.log(
  `Banco em ${env.databaseFile}: ${env.seedUsers.length} conta(s) em SEED_USERS, ${created} criada(s) agora.`
);

const app = createApp({ videosService, authService, corsOrigins: env.corsOrigins });

app.listen(env.port, () => {
  console.log(`API rodando em http://localhost:${env.port}/api`);
});

// Fecha o banco no encerramento, para o WAL não ficar com escrita pendente.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
