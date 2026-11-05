import { unauthorized } from './errors.js';

/**
 * Lê `Authorization: Bearer <token>`, valida a sessão e põe `req.user`.
 * Guarda também `req.token`, de que o logout precisa para apagar a linha certa.
 *
 * Express 5 repassa rejeição de função async ao tratador de erro, então aqui
 * não há try/catch (ADR-0003).
 */
export function createRequireAuth({ authService }) {
  return function requireAuth(req, res, next) {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');

    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token)
      return next(unauthorized('Faça login para continuar.'));

    req.user = authService.getSessionUser(token);
    req.token = token;
    next();
  };
}
