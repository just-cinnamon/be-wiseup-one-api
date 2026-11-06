import { Router } from 'express';
import { createRequireAuth } from '../http/requireAuth.js';
import { requireAdult } from '../http/requireAdult.js';
import { requireTerms } from '../http/requireTerms.js';
import { createAuthRoutes } from './auth.js';
import { createReportsRoutes } from './reports.js';

/**
 * Todas as rotas da API, montadas em /api.
 *
 * **A ordem aqui é a defesa** (ADR-0012): `/health` e `/auth` ficam abertos, e
 * tudo registrado depois do `requireAuth` exige sessão. Enquanto o catálogo
 * era público, o login do front não barrava ninguém — bastava chamar
 * `GET /api/home` direto para receber conteúdo +18 sem conta nenhuma.
 */
export function createRoutes({
  videosService,
  authService,
  moderation,
  accessLog,
  legalVersions = {},
}) {
  // Fail-closed: sem `authService` não há como exigir sessão. A resposta certa
  // é não subir, em vez de servir o catálogo para todo mundo.
  if (!authService) {
    throw new Error(
      'createRoutes exige authService: sem ele as rotas de catálogo ficariam abertas.'
    );
  }

  const router = Router();
  const requireAuth = createRequireAuth({ authService });

  // `private`, não `public`: a resposta passou a depender de quem pediu, e
  // nenhum intermediário (CDN, proxy do provedor) pode guardar uma cópia para
  // entregar a outra pessoa. O navegador de quem pediu continua guardando.
  const cacheFor = (seconds) => (req, res, next) => {
    res.set('Cache-Control', `private, max-age=${seconds}`);
    next();
  };

  // Aberta de propósito: é o que o provedor consulta para saber se o processo
  // está de pé, e não devolve dado nenhum.
  router.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Também aberta, por necessidade: é por aqui que se consegue a sessão. Estas
  // rotas trazem o próprio Cache-Control: no-store, posto em app.js.
  router.use('/auth', createAuthRoutes({ authService, accessLog, legalVersions }));

  // ---- Daqui para baixo: sessão válida, idade verificada e termos aceitos. ----
  router.use(requireAuth);
  router.use(requireAdult);
  router.use(requireTerms);

  router.get('/home', cacheFor(300), async (req, res) => {
    res.json(await videosService.getHome());
  });

  router.get('/videos', cacheFor(300), async (req, res) => {
    res.json(await videosService.listVideos(req.query));
  });

  router.get('/videos/:id', cacheFor(300), async (req, res) => {
    res.json(await videosService.getVideo(req.params.id));
  });

  router.get('/categories', cacheFor(86400), async (req, res) => {
    res.json(await videosService.getCategories());
  });

  // Denúncia (ADR-0017). Sem `moderation` a rota não existe, em vez de existir
  // e aceitar denúncia que ninguém guarda — o que seria pior do que não ter
  // botão: a pessoa acreditaria ter denunciado.
  if (moderation) {
    router.use('/reports', createReportsRoutes({ moderation }));
  }

  return router;
}
