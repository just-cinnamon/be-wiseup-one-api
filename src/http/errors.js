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

// Declaração de maioridade (ADR-0019).

/** Conta logada que ainda não declarou maioridade. O front manda para a tela. */
export const ageRequired = () =>
  new AppError(
    403,
    'AGE_REQUIRED',
    'Confirme que você é maior de 18 anos para acessar o conteúdo.'
  );

// Aceite de termos (ADR-0016).

/** Conta logada e verificada, sem aceitar a versão vigente dos documentos. */
export const termsRequired = () =>
  new AppError(
    403,
    'TERMS_REQUIRED',
    'Aceite os Termos de Uso e a Política de Privacidade para continuar.'
  );

// Denúncia e moderação (ADR-0017).

/** Limite de denúncias por hora, por conta. */
export const tooManyReports = () =>
  new AppError(
    429,
    'TOO_MANY_REPORTS',
    'Você fez muitas denúncias na última hora. Tente novamente mais tarde.'
  );

/** Rota de análise de denúncia, com conta que não é de administrador. */
export const adminOnly = () =>
  new AppError(403, 'ADMIN_ONLY', 'Esta área é restrita à moderação.');
