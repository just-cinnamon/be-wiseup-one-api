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
  // Erros do express.json (corpo das rotas de /api/auth). Sem este trecho, um
  // JSON malformado viraria 500 e quebraria o contrato de erro da ADR-0007.
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: {
        code: 'INVALID_PARAMS',
        message: 'O corpo da requisição não é um JSON válido.',
      },
    });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'O corpo da requisição é grande demais.',
      },
    });
  }
  console.error(error);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'Erro inesperado no servidor.' } });
}
