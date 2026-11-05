import { Router } from 'express';

/** Todas as rotas da API, montadas em /api. */
export function createRoutes({ videosService }) {
  const router = Router();

  // Respostas de lista podem ser guardadas pelo navegador por 5 minutos.
  const cacheFor = (seconds) => (req, res, next) => {
    res.set('Cache-Control', `public, max-age=${seconds}`);
    next();
  };

  router.get('/health', (req, res) => res.json({ status: 'ok' }));

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
