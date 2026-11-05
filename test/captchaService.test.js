import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaptchaService } from '../src/services/captchaService.js';

const TOKEN = 'x'.repeat(300);

/** fetch falso, no padrão da ADR-0005 (injeção de dependência). */
function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  };
  fn.calls = calls;
  return fn;
}

const ok = (body) => async () => ({ ok: true, json: async () => body });

test('manda secret e response para o siteverify e aceita success: true', async () => {
  const fetchFn = fakeFetch(ok({ success: true }));
  const service = createCaptchaService({ secret: 'segredo-do-servidor', fetchFn });

  assert.equal(await service.verify(TOKEN), true);
  assert.equal(fetchFn.calls.length, 1);

  const { url, options } = fetchFn.calls[0];
  assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
  assert.equal(options.method, 'POST');
  const body = new URLSearchParams(options.body);
  assert.equal(body.get('secret'), 'segredo-do-servidor');
  assert.equal(body.get('response'), TOKEN);
});

test('recusa quando o Google responde success: false', async () => {
  const service = createCaptchaService({
    secret: 's',
    fetchFn: fakeFetch(ok({ success: false, 'error-codes': ['invalid-input-response'] })),
  });
  assert.equal(await service.verify(TOKEN), false);
});

test('recusa quando o Google falha, erra ou demora', async () => {
  const cenarios = [
    async () => ({ ok: false, json: async () => ({}) }),
    async () => {
      throw Object.assign(new Error('tempo esgotado'), { name: 'TimeoutError' });
    },
    async () => {
      throw new Error('rede fora');
    },
    ok({}), // resposta sem o campo success
  ];
  for (const responder of cenarios) {
    const service = createCaptchaService({ secret: 's', fetchFn: fakeFetch(responder) });
    assert.equal(await service.verify(TOKEN), false);
  }
});

test('recusa token ausente ou absurdo sem chamar o Google', async () => {
  const fetchFn = fakeFetch(ok({ success: true }));
  const service = createCaptchaService({ secret: 's', fetchFn });

  for (const token of ['', 'curto', null, undefined, 42, 'y'.repeat(4001)]) {
    assert.equal(await service.verify(token), false);
  }
  assert.equal(fetchFn.calls.length, 0);
});

test('sem secret: recusa em produção e passa em desenvolvimento', async () => {
  const fetchFn = fakeFetch(ok({ success: true }));

  const producao = createCaptchaService({ secret: '', isProduction: true, fetchFn });
  assert.equal(await producao.verify(TOKEN), false);

  const desenvolvimento = createCaptchaService({
    secret: '',
    isProduction: false,
    fetchFn,
  });
  assert.equal(await desenvolvimento.verify(TOKEN), true);

  // Nos dois casos, nada é enviado ao Google.
  assert.equal(fetchFn.calls.length, 0);
});
