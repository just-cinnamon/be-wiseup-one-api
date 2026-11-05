import { AppError } from './errors.js';

/** Rotas que não existem. */
export function notFoundHandler(req, res) {
  res
    .status(404)
    .json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.' } });
}

/** Todo erro vira o mesmo formato de JSON. Express 5 já repassa erros de funções async. */
// Os 4 parâmetros são obrigatórios: é assim que o Express reconhece um tratador de erro.
export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    return res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  }
  console.error(error);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'Erro inesperado no servidor.' } });
}
