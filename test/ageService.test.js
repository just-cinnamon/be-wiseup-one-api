import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createAgeService } from '../src/services/ageService.js';

/*
 * O adaptador do provedor de verificação de idade (ADR-0015), com `fetch`
 * falso — padrão da ADR-0005. Aqui se testa a parte que fala com fora: o que
 * é mandado, o que é aceito de volta e o que acontece quando o provedor falha.
 */

const CONFIG = {
  providerUrl: 'https://provedor.exemplo/v1',
  providerKey: 'chave-secreta',
  webhookSecret: 'segredo-do-webhook',
  now: () => new Date('2026-11-05T12:00:00.000Z'),
};

/** `fetch` falso que registra a chamada e responde o que for pedido. */
function fakeFetch(resposta) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (resposta instanceof Error) throw resposta;
    return {
      ok: resposta.ok ?? true,
      json: async () => resposta.body ?? {},
    };
  };
  return { fn, calls };
}

const erroDe = async (fn) => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('esperava um erro, mas não houve nenhum');
};

test('createSession manda referência opaca, e não o e-mail', async () => {
  const { fn, calls } = fakeFetch({
    body: { url: 'https://provedor.exemplo/abrir/123' },
  });
  const service = createAgeService({ ...CONFIG, fetchFn: fn });

  const sessao = await service.createSession({ userId: 'u1' });

  assert.match(sessao.ref, /^[0-9a-f-]{36}$/);
  assert.equal(sessao.url, 'https://provedor.exemplo/abrir/123');
  assert.equal(sessao.autoVerified, false);

  const [chamada] = calls;
  assert.equal(chamada.url, 'https://provedor.exemplo/v1/sessions');
  assert.equal(chamada.options.headers.Authorization, 'Bearer chave-secreta');

  const corpo = JSON.parse(chamada.options.body);
  assert.equal(corpo.client_reference, sessao.ref);
  assert.deepEqual(corpo.checks, ['age_over_18']);
  // O provedor não precisa saber quem é a pessoa para dizer se é adulta.
  assert.ok(!chamada.options.body.includes('@'));
});

test('provedor fora do ar, lento ou sem URL nunca libera', async () => {
  for (const resposta of [
    new Error('conexão caiu'),
    { ok: false },
    { body: {} }, // 200 sem a URL de abertura
  ]) {
    const { fn } = fakeFetch(resposta);
    const service = createAgeService({ ...CONFIG, fetchFn: fn });
    const erro = await erroDe(() => service.createSession({ userId: 'u1' }));
    assert.equal(erro.status, 503);
    assert.equal(erro.code, 'AGE_PROVIDER_UNAVAILABLE');
  }
});

test('sem chave do provedor, recusa — inclusive em desenvolvimento', async () => {
  const service = createAgeService({ webhookSecret: 'x' });
  assert.equal(service.isConfigured(), false);

  const erro = await erroDe(() => service.createSession({ userId: 'u1' }));
  assert.equal(erro.code, 'AGE_PROVIDER_UNAVAILABLE');
});

test('verifyWebhook confere o HMAC do corpo cru', async () => {
  const service = createAgeService(CONFIG);
  const rawBody = '{"client_reference":"ref-1","result":"approved"}';
  const assinatura = createHmac('sha256', CONFIG.webhookSecret)
    .update(rawBody)
    .digest('hex');

  assert.equal(service.verifyWebhook({ rawBody, signature: assinatura }), true);
  // O prefixo `sha256=`, que alguns provedores mandam, é aceito.
  assert.equal(
    service.verifyWebhook({ rawBody, signature: `sha256=${assinatura}` }),
    true
  );

  // Qualquer byte diferente invalida: é o ponto de assinar o corpo cru.
  assert.equal(
    service.verifyWebhook({ rawBody: `${rawBody} `, signature: assinatura }),
    false
  );
  assert.equal(service.verifyWebhook({ rawBody, signature: 'abc' }), false);
  assert.equal(service.verifyWebhook({ rawBody, signature: undefined }), false);
  assert.equal(service.verifyWebhook({ rawBody: '', signature: assinatura }), false);
});

test('sem AGE_WEBHOOK_SECRET nenhuma assinatura é aceita', () => {
  const service = createAgeService({ providerUrl: 'x', providerKey: 'y' });
  const rawBody = '{}';
  const qualquer = createHmac('sha256', '').update(rawBody).digest('hex');
  assert.equal(service.verifyWebhook({ rawBody, signature: qualquer }), false);
});

test('parseWebhook só aceita o que sabe ler', () => {
  const service = createAgeService(CONFIG);

  assert.deepEqual(service.parseWebhook({ client_reference: 'r', result: 'approved' }), {
    ref: 'r',
    approved: true,
    method: null,
    verifiedAt: '2026-11-05T12:00:00.000Z',
  });

  // A outra forma de aprovação que o provedor pode usar.
  assert.equal(
    service.parseWebhook({ client_reference: 'r', age_over_18: true }).approved,
    true
  );
  assert.equal(
    service.parseWebhook({ client_reference: 'r', result: 'declined' }).approved,
    false
  );

  // Método fora da lista permitida não é guardado (ADR-0007).
  assert.equal(
    service.parseWebhook({ client_reference: 'r', result: 'approved', method: 'chute' })
      .method,
    null
  );
  assert.equal(
    service.parseWebhook({
      client_reference: 'r',
      result: 'approved',
      method: 'documento',
    }).method,
    'documento'
  );

  // Sem referência não há a quem atribuir: nada a fazer.
  assert.equal(service.parseWebhook({ result: 'approved' }), null);
  assert.equal(service.parseWebhook(null), null);
});
