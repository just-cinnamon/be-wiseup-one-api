/**
 * Erros com status HTTP e código fixo. O errorHandler transforma em JSON:
 * { "error": { "code": "...", "message": "..." } }
 */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const invalidParams = (message) => new AppError(400, 'INVALID_PARAMS', message);
export const notFound = (message = 'Vídeo não encontrado.') =>
  new AppError(404, 'NOT_FOUND', message);
export const upstreamTimeout = () =>
  new AppError(504, 'UPSTREAM_TIMEOUT', 'O serviço de vídeos demorou para responder.');
export const upstreamUnavailable = () =>
  new AppError(502, 'UPSTREAM_UNAVAILABLE', 'Não foi possível carregar os vídeos agora.');
