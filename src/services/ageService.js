import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ageProviderUnavailable } from '../http/errors.js';

/**
 * Verificação de idade por provedor externo (ADR-0015).
 *
 * **Este arquivo é o único que fala com o provedor.** Trocar Yoti por Unico ou
 * Idwall deve parar aqui — como o `pornhubClient` faz com a API de vídeos
 * (ADR-0005). Por isso recebe `fetchFn` por parâmetro, e por isso o formato do
 * corpo está isolado em `buildSessionBody`/`parseWebhook`.
 *
 * O que nunca acontece aqui: receber ou guardar documento, foto, CPF ou data de
 * nascimento. O provedor faz a verificação na tela dele e nos devolve três
 * coisas — se passou, como passou e um identificador. É só isso que sobe para
 * o banco.
 *
 * Sem `AGE_PROVIDER_KEY`, `createSession` **recusa** (503) em produção e em
 * desenvolvimento. Não existe caminho "passa sem provedor", com uma exceção
 * explícita e barulhenta: `AGE_DEV_AUTOVERIFY`, que só funciona fora de
 * produção e existe para o front ser desenvolvível sem contrato assinado.
 */
export function createAgeService({
  providerUrl,
  providerKey,
  webhookSecret,
  isProduction = false,
  devAutoVerify = false,
  fetchFn = fetch,
  timeoutMs = 8000,
  now = () => new Date(),
}) {
  const configured = Boolean(providerUrl && providerKey);
  // O atalho de desenvolvimento nunca vale em produção, nem por engano de
  // variável: a checagem é feita aqui, uma vez, e não em cada chamada.
  const autoVerify = devAutoVerify && !isProduction;

  if (!configured && !autoVerify) {
    console.warn(
      'AVISO: AGE_PROVIDER_URL/AGE_PROVIDER_KEY não cadastradas. A verificação de idade vai recusar todas as tentativas, e o catálogo fica inacessível.'
    );
  }
  if (autoVerify) {
    console.warn(
      'ATENÇÃO: AGE_DEV_AUTOVERIFY está ligado. Qualquer conta é marcada como verificada SEM provedor nenhum. Isto só funciona fora de produção — jamais cadastre esta variável no provedor de produção.'
    );
  }

  /** Corpo esperado pelo provedor. Único lugar com o formato dele. */
  const buildSessionBody = ({ userId, ref }) => ({
    client_reference: ref,
    // Mandamos uma referência opaca, não o e-mail: o provedor não precisa
    // saber quem é a pessoa para dizer se ela é adulta.
    subject: `user:${userId}`,
    checks: ['age_over_18'],
  });

  return {
    isConfigured: () => configured,
    isAutoVerify: () => autoVerify,

    /**
     * Abre uma verificação no provedor e devolve `{ ref, url, method }`.
     * `ref` é o que o webhook vai citar; `url` é para onde o front manda a
     * pessoa. Nada é marcado como verificado aqui.
     */
    async createSession({ userId }) {
      const ref = randomUUID();

      if (autoVerify) {
        return {
          ref,
          url: null,
          method: 'desenvolvimento',
          autoVerified: true,
        };
      }

      if (!configured) throw ageProviderUnavailable();

      let response;
      try {
        response = await fetchFn(`${providerUrl.replace(/\/$/, '')}/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${providerKey}`,
            'User-Agent': 'be-wiseup-one-api/0.1',
          },
          body: JSON.stringify(buildSessionBody({ userId, ref })),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Provedor fora do ar ou lento não libera nada: sem verificação, sem
        // catálogo. O front mostra "tente mais tarde".
        throw ageProviderUnavailable();
      }

      if (!response.ok) throw ageProviderUnavailable();

      const data = await response.json().catch(() => null);
      const url = typeof data?.url === 'string' ? data.url : null;
      if (!url) throw ageProviderUnavailable();

      return { ref, url, method: null, autoVerified: false };
    },

    /**
     * Confere a assinatura do webhook: HMAC-SHA256 do corpo **cru**, com o
     * `AGE_WEBHOOK_SECRET`, comparado em tempo constante.
     *
     * Sem segredo cadastrado, recusa. Um webhook que marca contas como
     * verificadas sem assinatura conferida é um endpoint para qualquer um
     * liberar o próprio acesso.
     */
    verifyWebhook({ rawBody, signature }) {
      if (!webhookSecret || typeof signature !== 'string' || !rawBody) return false;

      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const recebido = Buffer.from(signature.replace(/^sha256=/, ''), 'utf8');
      const esperado = Buffer.from(expected, 'utf8');

      // `timingSafeEqual` exige tamanhos iguais, e comparar tamanho antes não
      // vaza nada útil: o tamanho do hex é fixo e público.
      if (recebido.length !== esperado.length) return false;
      return timingSafeEqual(recebido, esperado);
    },

    /**
     * Traduz o corpo do webhook para o que o banco guarda.
     * Devolve `null` quando não dá para confiar no que chegou.
     */
    parseWebhook(body) {
      const ref = typeof body?.client_reference === 'string' ? body.client_reference : '';
      if (!ref) return null;

      const aprovado = body?.result === 'approved' || body?.age_over_18 === true;
      const metodos = ['facial', 'documento', 'banco'];
      const method = metodos.includes(body?.method) ? body.method : null;

      return {
        ref,
        approved: aprovado,
        method,
        verifiedAt: now().toISOString(),
      };
    },
  };
}
