/**
 * Lê e valida as variáveis de ambiente.
 * Em desenvolvimento vêm do arquivo .env (npm run dev); em produção, do provedor.
 */
const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  port: toInt(process.env.PORT, 3333),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL ?? 'https://www.pornhub.com/webmasters',
  upstreamTimeoutMs: toInt(process.env.UPSTREAM_TIMEOUT_MS, 8000),
  cacheTtlSeconds: toInt(process.env.CACHE_TTL_SECONDS, 600),
};
