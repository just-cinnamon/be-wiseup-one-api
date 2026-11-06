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

// Autenticação (ADR-0011).

/** Mensagem única de propósito: não revela se o e-mail existe. */
export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');

export const tooManyAttempts = (minutes) =>
  new AppError(
    429,
    'TOO_MANY_ATTEMPTS',
    `Muitas tentativas de login. Tente novamente em ${minutes} minutos.`
  );

export const captchaFailed = () =>
  new AppError(400, 'CAPTCHA_FAILED', 'Confirme que você não é um robô e tente de novo.');

export const unauthorized = (message = 'Sessão expirada. Entre novamente.') =>
  new AppError(401, 'UNAUTHORIZED', message);

// Verificação de idade (ADR-0015).

/** Conta logada, idade não verificada. O front manda para /verificar-idade. */
export const ageRequired = () =>
  new AppError(
    403,
    'AGE_REQUIRED',
    'Verifique que você é maior de 18 anos para acessar o conteúdo.'
  );

/** Sem provedor configurado, ou provedor fora do ar. Nunca libera o acesso. */
export const ageProviderUnavailable = () =>
  new AppError(
    503,
    'AGE_PROVIDER_UNAVAILABLE',
    'A verificação de idade está indisponível agora. Tente novamente mais tarde.'
  );
