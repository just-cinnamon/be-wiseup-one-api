import { adminOnly } from './errors.js';

/**
 * Barra quem não é administrador (ADR-0017).
 *
 * `isAdmin` vem da sessão, da mesma consulta que já traz idade e termos. Não
 * existe rota que promova ninguém: a coluna `is_admin` é marcada à mão no
 * banco, o que é lento de propósito — administrador se ganha por fora, não por
 * requisição HTTP.
 */
export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return next(adminOnly());
  next();
}
