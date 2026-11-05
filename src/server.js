import { createApp } from './app.js';
import { env } from './config/env.js';
import { createCache } from './services/cache.js';
import { createPornhubClient } from './services/pornhubClient.js';
import { createVideosService } from './services/videosService.js';

const cache = createCache({ ttlSeconds: env.cacheTtlSeconds });
const client = createPornhubClient({
  baseUrl: env.upstreamBaseUrl,
  timeoutMs: env.upstreamTimeoutMs,
  cache,
});
const videosService = createVideosService({ client });
const app = createApp({ videosService, corsOrigins: env.corsOrigins });

app.listen(env.port, () => {
  console.log(`API rodando em http://localhost:${env.port}/api`);
});
