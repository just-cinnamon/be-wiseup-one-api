import { Router } from 'express';
import { createRequireAuth } from '../http/requireAuth.js';
import { invalidParams, unauthorized } from '../http/errors.js';

/**
 * Rotas da verificação de idade, montadas em /api/age (ADR-0015).
 *
 * `/session` e `/status` exigem sessão; `/webhook` **não pode** exigir, porque
 * quem chama é o provedor — e por isso ele é o único autenticado por
 * assinatura HMAC do corpo cru.
 *
 * Nenhuma destas rotas passa pelo `requireAdult`: seria o cadeado trancando a
 * chave dentro.
 */
export function createAgeRoutes({ ageService, users, authService }) {
  const router = Router();
  const requireAuth = createRequireAuth({ authService });

  /**
   * Abre a verificação e devolve para onde o front deve mandar a pessoa.
   *
   * Reabrir é permitido de propósito: desistir no meio é comum, e a conta
   * ficaria presa numa referência que nunca vai receber webhook.
   */
  router.post('/session', requireAuth, async (req, res) => {
    const user = await users.findById(req.user.id);
    if (!user) throw unauthorized();

    // Já verificada: não cria sessão nova no provedor (que é pago por
    // verificação) nem apaga o que já foi comprovado.
    if (user.age_verified_at) {
      return res.json({ ageVerified: true, url: null });
    }

    const session = await ageService.createSession({ userId: user.id });
    await users.setAgeRef(user.id, { ref: session.ref, method: session.method });

    // Atalho de desenvolvimento (AGE_DEV_AUTOVERIFY), impossível em produção:
    // o próprio serviço já recusou lá.
    if (session.autoVerified) {
      await users.setAgeVerified({
        ref: session.ref,
        verifiedAt: new Date().toISOString(),
        method: 'desenvolvimento',
      });
      return res.json({ ageVerified: true, url: null, dev: true });
    }

    res.json({ ageVerified: false, url: session.url });
  });

  /** O front consulta depois de voltar do provedor. */
  router.get('/status', requireAuth, async (req, res) => {
    const user = await users.findById(req.user.id);
    if (!user) throw unauthorized();

    res.json({
      ageVerified: Boolean(user.age_verified_at),
      // "Em andamento" é ter referência e não ter resultado: é o que distingue
      // "nunca tentou" de "está esperando o provedor".
      pending: Boolean(user.age_ref) && !user.age_verified_at,
      method: user.age_method ?? null,
      verifiedAt: user.age_verified_at ?? null,
    });
  });

  /**
   * Resultado vindo do provedor. Autenticado por assinatura, não por sessão.
   *
   * Responde 200 também para verificação reprovada: o 200 diz "recebi e
   * entendi", e repetir a entrega não mudaria nada. O que o provedor não pode
   * receber é 200 para assinatura inválida.
   */
  router.post('/webhook', async (req, res) => {
    const assinatura =
      req.get('x-signature') ??
      req.get('x-age-signature') ??
      req.get('x-hub-signature-256');

    if (!ageService.verifyWebhook({ rawBody: req.rawBody, signature: assinatura })) {
      // Sem detalhe na resposta: quem está tentando adivinhar a assinatura não
      // ganha pista nenhuma.
      throw unauthorized('Assinatura inválida.');
    }

    const resultado = ageService.parseWebhook(req.body);
    if (!resultado) throw invalidParams('Corpo do webhook não reconhecido.');

    if (!resultado.approved) {
      // Reprovado não marca nada: a conta continua sem acesso, e a pessoa pode
      // tentar de novo. O log não registra e-mail nem a referência.
      console.log('Verificação de idade reprovada pelo provedor.');
      return res.json({ ok: true, ageVerified: false });
    }

    const conta = await users.findByAgeRef(resultado.ref);
    if (!conta) {
      // Referência desconhecida: provavelmente conta excluída no meio do
      // processo. Não é erro do provedor, e repetir não resolveria.
      return res.json({ ok: true, ageVerified: false });
    }

    await users.setAgeVerified({
      ref: resultado.ref,
      verifiedAt: resultado.verifiedAt,
      method: resultado.method,
    });

    res.json({ ok: true, ageVerified: true });
  });

  return router;
}
