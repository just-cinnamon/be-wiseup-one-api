import { Router } from 'express';
import { createRequireAuth } from '../http/requireAuth.js';

/**
 * Rotas de autenticação, montadas em /api/auth (ADR-0011).
 * Cadastro e "esqueci a senha" estão fora do escopo de propósito.
 */
export function createAuthRoutes({ authService }) {
  const router = Router();
  const requireAuth = createRequireAuth({ authService });

  // O Cache-Control: no-store destas rotas é posto em app.js, antes do parser
  // de JSON — assim vale até quando o corpo chega malformado. Nenhuma resposta
  // de /auth pode ficar em cache: a de login tem token dentro, e um navegador
  // compartilhado o entregaria para a próxima pessoa.

  router.post('/login', async (req, res) => {
    res.json(await authService.login(req.body));
  });

  // O front chama ao abrir, para saber se o token guardado ainda vale.
  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/logout', requireAuth, (req, res) => {
    authService.logout(req.token);
    res.json({ ok: true });
  });

  // Direito de exclusão (LGPD): apaga a conta e todas as sessões dela.
  router.delete('/me', requireAuth, (req, res) => {
    authService.deleteAccount(req.user.id);
    res.json({ ok: true });
  });

  return router;
}
