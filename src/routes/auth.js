import { Router } from 'express';
import { createRequireAuth } from '../http/requireAuth.js';

/**
 * Rotas de autenticação, montadas em /api/auth (ADR-0011).
 * Cadastro e "esqueci a senha" estão fora do escopo de propósito.
 */
export function createAuthRoutes({ authService, accessLog = null, legalVersions = {} }) {
  const router = Router();
  const requireAuth = createRequireAuth({ authService });

  // O Cache-Control: no-store destas rotas é posto em app.js, antes do parser
  // de JSON — assim vale até quando o corpo chega malformado. Nenhuma resposta
  // de /auth pode ficar em cache: a de login tem token dentro, e um navegador
  // compartilhado o entregaria para a próxima pessoa.

  router.post('/login', async (req, res) => {
    const resultado = await authService.login(req.body);

    // Registro de acesso do Marco Civil (ADR-0018): uma linha por login, com
    // IP e data. `record` nunca lança — falha no registro não pode impedir
    // alguém de entrar na conta —, e vem **depois** do login justamente para
    // tentativa recusada não virar registro de acesso.
    if (accessLog) await accessLog.record({ userId: resultado.user.id, ip: req.ip });

    res.json(resultado);
  });

  // O front chama ao abrir, para saber se o token guardado ainda vale. A
  // resposta traz `ageVerified` e `termsAccepted`, que é como o front decide
  // qual tela mostrar sem esperar um 403.
  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user, legalVersions });
  });

  /**
   * Aceite dos documentos legais (ADR-0016). Exige sessão e **não** exige
   * termos aceitos — seria o cadeado trancando a chave dentro, como em /age.
   *
   * Aceitar é um ato: não há corpo a validar, porque não há opção a escolher.
   * Os dois documentos são obrigatórios, e a caixa de seleção que a pessoa
   * marcou está na tela do front, não aqui.
   */
  router.post('/accept-terms', requireAuth, async (req, res) => {
    const { acceptedAt, versions } = await authService.acceptTerms(req.user.id);
    res.json({ termsAccepted: true, acceptedAt, versions });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    await authService.logout(req.token);
    res.json({ ok: true });
  });

  // Direito de exclusão (LGPD): apaga a conta e todas as sessões dela.
  router.delete('/me', requireAuth, async (req, res) => {
    await authService.deleteAccount(req.user.id);
    res.json({ ok: true });
  });

  return router;
}
