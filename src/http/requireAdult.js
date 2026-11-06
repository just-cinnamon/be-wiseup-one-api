import { ageRequired } from './errors.js';

/**
 * Barra quem está logado e não verificou a idade (ADR-0015).
 *
 * Roda **depois** do `requireAuth`, que põe `req.user`. A ordem em
 * `routes/index.js` é a regra: sessão, idade, catálogo. Nenhuma miniatura sai
 * da API antes disso — é o ponto da Fase 1 do plano de prevenção.
 */
export function requireAdult(req, res, next) {
  // `ageVerified` vem da sessão, montada no `authService.getSessionUser`.
  // Tratar ausência como "não verificado" é a escolha fail-closed: um campo
  // que falta nunca pode liberar acesso.
  if (!req.user?.ageVerified) return next(ageRequired());
  next();
}
