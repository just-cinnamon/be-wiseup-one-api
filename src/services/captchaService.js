const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Confere o token do reCAPTCHA v2 no `siteverify` do Google (ADR-0011).
 *
 * Recebe `fetchFn` por parâmetro, como o pornhubClient (ADR-0005): nos testes,
 * uma função falsa; em produção, o `fetch` global.
 */
export function createCaptchaService({
  secret,
  timeoutMs = 8000,
  isProduction = false,
  fetchFn = fetch,
  verifyUrl = SITEVERIFY_URL,
}) {
  let warned = false;

  /** Devolve true só quando o Google confirma. Nunca lança. */
  async function verify(token) {
    if (!secret) {
      // Sem secret, recusa em produção e passa em desenvolvimento — nunca o
      // contrário. Um deploy sem a variável cadastrada tem de barrar o login,
      // não liberá-lo.
      if (isProduction) {
        console.error(
          'ERRO: RECAPTCHA_SECRET não está cadastrado. Todo login será recusado.'
        );
        return false;
      }
      if (!warned) {
        warned = true;
        console.warn(
          'AVISO: sem RECAPTCHA_SECRET, o captcha não é conferido. Só em desenvolvimento.'
        );
      }
      return true;
    }

    if (typeof token !== 'string' || token.length < 20 || token.length > 4000)
      return false;

    try {
      const res = await fetchFn(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'be-wiseup-one-api/0.1',
        },
        body: new URLSearchParams({ secret, response: token }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data?.success === true;
    } catch {
      // Google fora do ar ou lento vira captcha recusado, e o front mostra
      // "tente de novo". Liberar o login quando o verificador falha anularia
      // a razão de ele existir.
      return false;
    }
  }

  return { verify };
}
