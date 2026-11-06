/**
 * Lê e valida as variáveis de ambiente.
 * Em desenvolvimento vêm do arquivo .env (npm run dev); em produção, do provedor.
 */
const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Contas semeadas no boot (ADR-0011), no formato `email:senha,email:senha`.
 * A senha pode conter ':' — só a primeira ocorrência separa.
 * Entrada malformada é descartada em silêncio: a senha não pode aparecer em log.
 */
export function parseSeedUsers(value) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator < 1) return null;
      const email = entry.slice(0, separator).trim().toLowerCase();
      const password = entry.slice(separator + 1);
      return email && password ? { email, password } : null;
    })
    .filter(Boolean);
}

export const env = {
  port: toInt(process.env.PORT, 3333),
  isProduction: process.env.NODE_ENV === 'production',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL ?? 'https://www.pornhub.com/webmasters',
  upstreamTimeoutMs: toInt(process.env.UPSTREAM_TIMEOUT_MS, 8000),
  cacheTtlSeconds: toInt(process.env.CACHE_TTL_SECONDS, 600),

  // Banco (ADR-0013): Postgres gerenciado, no lugar do arquivo SQLite que o
  // disco efêmero do Render apagava a cada deploy.
  databaseUrl: (process.env.DATABASE_URL ?? '').trim(),
  // Só para provedor com certificado próprio. Ligado, deixa de validar o
  // certificado do servidor — escolha explícita, nunca o padrão.
  databaseSslInsecure: process.env.DATABASE_SSL_INSECURE === 'true',

  // Autenticação (ADR-0011)
  recaptchaSecret: (process.env.RECAPTCHA_SECRET ?? '').trim(),
  sessionTtlHours: toInt(process.env.SESSION_TTL_HOURS, 12),
  loginMaxAttempts: toInt(process.env.LOGIN_MAX_ATTEMPTS, 5),
  loginLockMinutes: toInt(process.env.LOGIN_LOCK_MINUTES, 15),
  seedUsers: parseSeedUsers(process.env.SEED_USERS),
};
