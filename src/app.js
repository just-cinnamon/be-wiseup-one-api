import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from './http/errorHandler.js';
import { createRoutes } from './routes/index.js';

/** Monta o Express. Não chama listen, para poder ser usado nos testes. */
export function createApp({
  videosService,
  authService,
  ageService,
  moderation,
  users,
  legalVersions,
  corsOrigins,
}) {
  const app = express();

  app.disable('x-powered-by');
  // POST e DELETE entraram com as rotas de /api/auth (ADR-0011); até a ADR-0007
  // só havia GET. O resto da API continua só com GET.
  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Log enxuto: método, rota, status e tempo. Sem termos de busca e sem e-mail.
  // A rota é guardada agora, antes de entrar no roteador: ao montar em '/api' o
  // Express reescreve req.url, e no evento 'finish' o prefixo já teria sumido.
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      console.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  // Corpo JSON só onde existe corpo: /api/auth, /api/age e /api/reports. O
  // catálogo é todo GET e não ganha parser. Limite pequeno porque o maior
  // campo é a observação da denúncia, de 500 caracteres.
  // O no-store vem antes do parser para valer também quando o JSON é inválido.
  app.use(
    ['/api/auth', '/api/age', '/api/reports'],
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    express.json({
      limit: '4kb',
      // O corpo cru é o que o webhook de idade assina (ADR-0015): depois do
      // parser, `JSON.stringify(req.body)` não reproduz byte a byte o que o
      // provedor assinou, e a assinatura nunca bateria.
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  app.use(
    '/api',
    createRoutes({
      videosService,
      authService,
      ageService,
      moderation,
      users,
      legalVersions,
    })
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
