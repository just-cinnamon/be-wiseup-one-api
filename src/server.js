// Primeiro import de propósito: confere a versão do Node antes de carregar o
// Express, que não funciona em versões antigas.
import './config/checkNode.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { LEGAL_VERSIONS } from './config/legal.js';
import { createDatabase } from './db/database.js';
import { createAccessLogService } from './services/accessLogService.js';
import { createAgeService } from './services/ageService.js';
import { createAuthService } from './services/authService.js';
import { createCache } from './services/cache.js';
import { createCaptchaService } from './services/captchaService.js';
import { createModerationService } from './services/moderationService.js';
import { createPornhubClient } from './services/pornhubClient.js';
import { createReportsService } from './services/reportsService.js';
import { createUsersService } from './services/usersService.js';
import { createVideosService } from './services/videosService.js';

const cache = createCache({ ttlSeconds: env.cacheTtlSeconds });
const client = createPornhubClient({
  baseUrl: env.upstreamBaseUrl,
  timeoutMs: env.upstreamTimeoutMs,
  cache,
});

// Banco (ADR-0013) e autenticação (ADR-0011).
const db = createDatabase({
  connectionString: env.databaseUrl,
  sslInsecure: env.databaseSslInsecure,
});
await db.applySchema();

/*
 * Moderação (ADR-0017). Vem antes do `videosService` de propósito: o serviço de
 * catálogo recebe o filtro de bloqueados no construtor, e assim não existe
 * caminho em que o catálogo seja montado sem ele.
 */
const moderation = createModerationService({
  reports: createReportsService({ db }),
  client,
});
console.log(`Moderação: ${await moderation.refresh()} vídeo(s) fora do catálogo.`);

const videosService = createVideosService({ client, moderation });

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

/*
 * Registro de acesso (ADR-0018): uma linha por login, apagada depois de seis
 * meses. A faxina roda no boot e uma vez por dia — guardar além do prazo deixa
 * de ser cumprimento de obrigação legal e passa a ser retenção sem base.
 */
const accessLog = createAccessLogService({ db });

async function limparRegistrosAntigos() {
  try {
    const apagados = await accessLog.purge();
    if (apagados > 0) {
      console.log(
        `Registro de acesso: ${apagados} linha(s) com mais de 6 meses apagada(s).`
      );
    }
  } catch (error) {
    console.error('Falha na faxina do registro de acesso:', error.message);
  }
}

await limparRegistrosAntigos();
setInterval(limparRegistrosAntigos, 24 * 60 * 60 * 1000).unref();

const app = createApp({
  videosService,
  authService,
  ageService,
  moderation,
  accessLog,
  users,
  legalVersions: LEGAL_VERSIONS,
  corsOrigins: env.corsOrigins,
});

/*
 * Sincronismo com a origem (ADR-0017): o que a plataforma apagou sai daqui
 * também. Roda no boot e a cada 6 horas.
 *
 * `unref()` para o temporizador não segurar o processo no encerramento, e
 * `refresh()` depois de cada rodada porque, com mais de uma instância, o
 * bloqueio feito em outra só chega por aqui.
 */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function sincronizarOrigem() {
  const { blocked, skipped, failed } = await moderation.syncWithOrigin({ pages: 2 });
  await moderation.refresh();
  if (skipped) return;
  console.log(
    failed
      ? `Sincronismo com a origem falhou; ${blocked} bloqueio(s) antes da falha.`
      : `Sincronismo com a origem: ${blocked} vídeo(s) novo(s) bloqueado(s).`
  );
}

await sincronizarOrigem();
setInterval(() => {
  sincronizarOrigem().catch((error) =>
    console.error('Sincronismo com a origem lançou:', error.message)
  );
}, SYNC_INTERVAL_MS).unref();

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
