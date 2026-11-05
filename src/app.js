import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from './http/errorHandler.js';
import { createRoutes } from './routes/index.js';

/** Monta o Express. Não chama listen, para poder ser usado nos testes. */
export function createApp({ videosService, corsOrigins }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins, methods: ['GET'] }));

  // Log enxuto: método, rota, status e tempo. Sem termos de busca.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.use('/api', createRoutes({ videosService }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
