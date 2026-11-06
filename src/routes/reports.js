import { Router } from 'express';
import { requireAdmin } from '../http/requireAdmin.js';
import { REASONS } from '../services/moderationService.js';

/**
 * Denúncia e moderação (ADR-0017).
 *
 * Monta-se **depois** das barreiras de sessão, idade e termos: só quem entrou
 * vê o catálogo, e só quem vê o catálogo tem o que denunciar.
 *
 * As rotas de análise exigem `is_admin`, marcado à mão no banco.
 */
export function createReportsRoutes({ moderation }) {
  const router = Router();

  /** Os motivos que o front mostra na lista, para não haver duas listas. */
  router.get('/reasons', (req, res) => {
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ reasons: REASONS });
  });

  /**
   * Registra a denúncia. A resposta diz se o vídeo **já saiu do ar**, para o
   * front tirar o card na hora: dizer "obrigado, vamos analisar" enquanto a
   * miniatura continua na tela é a pior resposta possível para quem acabou de
   * denunciar conteúdo com menor de idade.
   */
  router.post('/', async (req, res) => {
    const resultado = await moderation.report({ userId: req.user.id, body: req.body });
    res.status(201).json(resultado);
  });

  // ---- Daqui para baixo, só moderação. ----
  router.use(requireAdmin);

  /** Fila de análise, das mais antigas para as mais novas. */
  router.get('/open', async (req, res) => {
    res.json({ reports: await moderation.listOpen() });
  });

  /** O que está fora do catálogo, e por quê. */
  router.get('/blocked', async (req, res) => {
    res.json({ blocked: await moderation.listBlocked() });
  });

  /**
   * Decisão sobre uma denúncia. `procede` bloqueia; `improcede` só devolve o
   * vídeo ao ar se o bloqueio tiver vindo desta denúncia.
   */
  router.post('/:id/review', async (req, res) => {
    const resultado = await moderation.review({
      id: req.params.id,
      procede: req.body?.procede === true,
      adminId: req.user.id,
    });
    res.json(resultado);
  });

  /** Bloqueio manual, sem denúncia. */
  router.post('/block', async (req, res) => {
    const resultado = await moderation.block({
      videoId: req.body?.videoId,
      adminId: req.user.id,
    });
    res.status(201).json(resultado);
  });

  return router;
}
