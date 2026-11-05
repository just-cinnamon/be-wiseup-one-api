import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { unauthorized } from '../src/http/errors.js';

/*
 * Testes de rota (ADR-0012): o catálogo só responde com sessão.
 *
 * Sem biblioteca de teste HTTP, que seria dependência nova (ADR-0003): o app
 * sobe numa porta livre (`listen(0)`) e o próprio `fetch` do Node faz as
 * chamadas.
 */

const VALID_TOKEN = 'token-de-sessao-valido';

const fakeVideosService = {
  getHome: async () => ({ featured: null, top10: [], rows: [] }),
  listVideos: async () => ({ videos: [], page: 1, hasMore: false }),
  getVideo: async () => ({ id: 'abc', title: 'x' }),
  getCategories: async () => [],
};

const fakeAuthService = {
  getSessionUser: (token) => {
    if (token !== VALID_TOKEN) throw unauthorized();
    return { id: 'u1', email: 'ana@wiseup.test' };
  },
  login: async () => ({
    user: { id: 'u1', email: 'ana@wiseup.test' },
    token: VALID_TOKEN,
  }),
  logout: () => {},
  deleteAccount: () => {},
};

/** Sobe o app numa porta livre, roda o teste e fecha sempre. */
async function withServer(run, { authService = fakeAuthService } = {}) {
  const app = createApp({
    videosService: fakeVideosService,
    authService,
    corsOrigins: ['http://localhost:5173'],
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

test('as rotas de catálogo recusam quem não tem sessão', async () => {
  await withServer(async (base) => {
    for (const path of [
      '/api/home',
      '/api/videos',
      '/api/videos/abc',
      '/api/categories',
    ]) {
      const response = await fetch(`${base}${path}`);
      const body = await response.json();
      assert.equal(response.status, 401, `${path} devia devolver 401`);
      assert.equal(body.error.code, 'UNAUTHORIZED');
    }
  });
});

test('token inválido ou esquema errado também não passa', async () => {
  await withServer(async (base) => {
    const semEsquema = await fetch(`${base}/api/home`, {
      headers: { Authorization: VALID_TOKEN },
    });
    assert.equal(semEsquema.status, 401);

    const tokenErrado = await fetch(`${base}/api/home`, bearer('qualquer-coisa'));
    assert.equal(tokenErrado.status, 401);
  });
});

test('com sessão válida o catálogo responde, e sem cache compartilhado', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/home`, bearer(VALID_TOKEN));
    assert.equal(response.status, 200);
    // `private`: proxy e CDN não podem guardar resposta de uma conta para
    // servir a outra.
    assert.match(response.headers.get('cache-control'), /^private, max-age=300$/);
    assert.deepEqual(await response.json(), { featured: null, top10: [], rows: [] });
  });
});

test('/health e o login continuam abertos', async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ana@wiseup.test', password: 'segredo123' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('cache-control'), 'no-store');
  });
});

test('sem authService o app não sobe, em vez de servir o catálogo aberto', () => {
  assert.throws(
    () =>
      createApp({
        videosService: fakeVideosService,
        authService: undefined,
        corsOrigins: [],
      }),
    /exige authService/
  );
});
