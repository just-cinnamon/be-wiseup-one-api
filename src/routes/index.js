import { Router } from 'express';
import { createRequireAuth } from '../http/requireAuth.js';
import { requireAdult } from '../http/requireAdult.js';
import { createAgeRoutes } from './age.js';
import { createAuthRoutes } from './auth.js';

/**
 * Todas as rotas da API, montadas em /api.
 *
 * **A ordem aqui é a defesa** (ADR-0012): `/health` e `/auth` ficam abertos, e
 * tudo registrado depois do `requireAuth` exige sessão. Enquanto o catálogo
 * era público, o login do front não barrava ninguém — bastava chamar
 * `GET /api/home` direto para receber conteúdo +18 sem conta nenhuma.
 */
export function createRoutes({ videosService, authService, ageService, users }) {
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
  router.use('/auth', createAuthRoutes({ authService }));

  // A verificação de idade fica **antes** do requireAdult, e cuida da própria
  // autenticação por rota (ADR-0015): exigir idade verificada para poder
  // verificar a idade seria o cadeado trancando a chave dentro.
  if (ageService && users) {
    router.use('/age', createAgeRoutes({ ageService, users, authService }));
  }

  // ---- Daqui para baixo, só com sessão válida e idade verificada. ----
  router.use(requireAuth);
  router.use(requireAdult);

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

  return router;
}
