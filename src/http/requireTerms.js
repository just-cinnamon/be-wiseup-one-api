import { termsRequired } from './errors.js';

/**
 * Barra quem não aceitou a **versão vigente** dos documentos (ADR-0016).
 *
 * Roda depois do `requireAuth` e do `requireAdult`. A ordem em
 * `routes/index.js` é a regra de acesso: sessão, idade, termos, catálogo.
 *
 * `termsAccepted` vem da sessão, calculado no `authService.getSessionUser`
 * contra `config/legal.js`. Ausente é "não aceitou" — como em todo o resto
 * daqui, um dado que falta não libera nada.
 */
export function requireTerms(req, res, next) {
  if (!req.user?.termsAccepted) return next(termsRequired());
  next();
}
