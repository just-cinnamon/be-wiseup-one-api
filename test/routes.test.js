import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { unauthorized } from '../src/http/errors.js';
import { createAgeService } from '../src/services/ageService.js';
import { fakeUsers } from './helpers.js';

/*
 * Testes de rota: quem passa e quem não passa (ADR-0012 e ADR-0015).
 *
 * Sem biblioteca de teste HTTP, que seria dependência nova (ADR-0003): o app
 * sobe numa porta livre (`listen(0)`) e o próprio `fetch` do Node chama.
 */

const VALID_TOKEN = 'token-de-sessao-valido';
const WEBHOOK_SECRET = 'segredo-do-webhook';
const AGORA = '2026-11-05T12:00:00.000Z';
const EMAIL = 'ana@wiseup.test';

const CATALOGO = ['/api/home', '/api/videos', '/api/videos/abc', '/api/categories'];
const LEGAL = { termos: '2026-11-05', privacidade: '2026-11-05' };

const fakeVideosService = {
  getHome: async () => ({ featured: null, top10: [], rows: [] }),
  listVideos: async () => ({ videos: [], page: 1, hasMore: false }),
  getVideo: async () => ({ id: 'abc', title: 'x' }),
  getCategories: async () => [],
};

/**
 * Sobe o app com `users` falso, uma conta já criada e um authService que só
 * aceita VALID_TOKEN. `ageVerified` decide se a conta nasce verificada.
 */
async function withServer(
  run,
  { ageVerified = true, termsAccepted = true, ageOptions = {} } = {}
) {
  const users = fakeUsers();
  const { id } = await users.create({
    email: EMAIL,
    passwordHash: 'scrypt$fake',
    createdAt: AGORA,
  });

  if (ageVerified) {
    await users.setAgeRef(id, { ref: 'ref-verificada', method: 'facial' });
    await users.setAgeVerified({
      ref: 'ref-verificada',
      verifiedAt: AGORA,
      method: 'facial',
    });
  }

  const aceitarTudo = async (userId) => {
    for (const [document, version] of Object.entries(LEGAL)) {
      await users.acceptTerms({ userId, document, version, acceptedAt: AGORA });
    }
    return { acceptedAt: AGORA, versions: LEGAL };
  };

  if (termsAccepted) await aceitarTudo(id);

  const authService = {
    getSessionUser: async (token) => {
      if (token !== VALID_TOKEN) throw unauthorized();
      const user = await users.findById(id);
      const aceites = await users.listAcceptances(id);
      return {
        id,
        email: user.email,
        ageVerified: Boolean(user.age_verified_at),
        termsAccepted: Object.entries(LEGAL).every(([document, version]) =>
          aceites.some((a) => a.document === document && a.version === version)
        ),
      };
    },
    login: async () => ({ user: { id, email: EMAIL }, token: VALID_TOKEN }),
    logout: async () => true,
    deleteAccount: async () => true,
    acceptTerms: aceitarTudo,
  };

  const ageService = createAgeService({
    webhookSecret: WEBHOOK_SECRET,
    now: () => new Date(AGORA),
    ...ageOptions,
  });

  const app = createApp({
    videosService: fakeVideosService,
    authService,
    ageService,
    users,
    legalVersions: LEGAL,
    corsOrigins: ['http://localhost:5173'],
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    await run({ base: `http://127.0.0.1:${server.address().port}`, users, userId: id });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Corpo e assinatura HMAC que o provedor mandaria. */
function assinado(payload, { secret = WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify(payload);
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': createHmac('sha256', secret).update(body).digest('hex'),
    },
    body,
  };
}

// ---- Sessão (ADR-0012) ----

test('as rotas de catálogo recusam quem não tem sessão', async () => {
  await withServer(async ({ base }) => {
    for (const path of CATALOGO) {
      const response = await fetch(`${base}${path}`);
      const body = await response.json();
      assert.equal(response.status, 401, `${path} devia devolver 401`);
      assert.equal(body.error.code, 'UNAUTHORIZED');
    }
  });
});

test('token inválido ou esquema errado também não passa', async () => {
  await withServer(async ({ base }) => {
    const semEsquema = await fetch(`${base}/api/home`, {
      headers: { Authorization: VALID_TOKEN },
    });
    assert.equal(semEsquema.status, 401);

    const tokenErrado = await fetch(`${base}/api/home`, bearer('qualquer-coisa'));
    assert.equal(tokenErrado.status, 401);
  });
});

test('com sessão e idade verificada o catálogo responde, sem cache compartilhado', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/home`, bearer(VALID_TOKEN));
    assert.equal(response.status, 200);
    // `private`: proxy e CDN não podem guardar resposta de uma conta para
    // servir a outra.
    assert.match(response.headers.get('cache-control'), /^private, max-age=300$/);
    assert.deepEqual(await response.json(), { featured: null, top10: [], rows: [] });
  });
});

test('/health e o login continuam abertos', async () => {
  await withServer(async ({ base }) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'segredo123' }),
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

// ---- Idade (ADR-0015) ----

test('logado sem idade verificada não vê nem miniatura', async () => {
  await withServer(
    async ({ base }) => {
      for (const path of CATALOGO) {
        const response = await fetch(`${base}${path}`, bearer(VALID_TOKEN));
        const body = await response.json();
        assert.equal(response.status, 403, `${path} devia devolver 403`);
        assert.equal(body.error.code, 'AGE_REQUIRED');
      }
    },
    { ageVerified: false }
  );
});

test('as rotas de idade exigem sessão, menos o webhook', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/age/status`)).status, 401);
    assert.equal(
      (await fetch(`${base}/api/age/session`, { method: 'POST' })).status,
      401
    );

    // O webhook não exige sessão — quem chama é o provedor — e recusa por
    // assinatura.
    const webhook = await fetch(`${base}/api/age/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_reference: 'x', result: 'approved' }),
    });
    assert.equal(webhook.status, 401);
  });
});

test('/age/status distingue nunca tentou, em andamento e verificado', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      const pedir = async () =>
        (await fetch(`${base}/api/age/status`, bearer(VALID_TOKEN))).json();

      assert.deepEqual(await pedir(), {
        ageVerified: false,
        pending: false,
        method: null,
        verifiedAt: null,
      });

      await users.setAgeRef(userId, { ref: 'ref-1', method: null });
      const andamento = await pedir();
      assert.equal(andamento.pending, true);
      assert.equal(andamento.ageVerified, false);

      await users.setAgeVerified({ ref: 'ref-1', verifiedAt: AGORA, method: 'facial' });
      assert.deepEqual(await pedir(), {
        ageVerified: true,
        pending: false,
        method: 'facial',
        verifiedAt: AGORA,
      });
    },
    { ageVerified: false }
  );
});

test('sem provedor cadastrado, abrir verificação dá 503 e não libera nada', async () => {
  await withServer(
    async ({ base }) => {
      const response = await fetch(`${base}/api/age/session`, {
        method: 'POST',
        ...bearer(VALID_TOKEN),
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'AGE_PROVIDER_UNAVAILABLE');

      // E o catálogo continua fechado.
      assert.equal((await fetch(`${base}/api/home`, bearer(VALID_TOKEN))).status, 403);
    },
    { ageVerified: false }
  );
});

test('o webhook assinado marca a conta, e o catálogo abre em seguida', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      await users.setAgeRef(userId, { ref: 'ref-provedor', method: null });

      const response = await fetch(
        `${base}/api/age/webhook`,
        assinado({
          client_reference: 'ref-provedor',
          result: 'approved',
          method: 'facial',
        })
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, ageVerified: true });

      const conta = await users.findById(userId);
      assert.equal(conta.age_verified_at, AGORA);
      assert.equal(conta.age_method, 'facial');

      assert.equal((await fetch(`${base}/api/home`, bearer(VALID_TOKEN))).status, 200);
    },
    { ageVerified: false }
  );
});

test('assinatura de outro segredo não marca nada', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      await users.setAgeRef(userId, { ref: 'ref-provedor', method: null });

      const response = await fetch(
        `${base}/api/age/webhook`,
        assinado(
          { client_reference: 'ref-provedor', result: 'approved' },
          { secret: 'segredo-errado' }
        )
      );
      assert.equal(response.status, 401);
      assert.equal((await users.findById(userId)).age_verified_at, null);
    },
    { ageVerified: false }
  );
});

test('verificação reprovada é recebida e não libera o acesso', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      await users.setAgeRef(userId, { ref: 'ref-provedor', method: null });

      const response = await fetch(
        `${base}/api/age/webhook`,
        assinado({ client_reference: 'ref-provedor', result: 'declined' })
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, ageVerified: false });
      assert.equal((await users.findById(userId)).age_verified_at, null);
      assert.equal((await fetch(`${base}/api/home`, bearer(VALID_TOKEN))).status, 403);
    },
    { ageVerified: false }
  );
});

test('AGE_DEV_AUTOVERIFY verifica sem provedor, e não existe em produção', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      const response = await fetch(`${base}/api/age/session`, {
        method: 'POST',
        ...bearer(VALID_TOKEN),
      });
      assert.deepEqual(await response.json(), {
        ageVerified: true,
        url: null,
        dev: true,
      });
      assert.equal((await users.findById(userId)).age_method, 'desenvolvimento');
      assert.equal((await fetch(`${base}/api/home`, bearer(VALID_TOKEN))).status, 200);
    },
    { ageVerified: false, ageOptions: { devAutoVerify: true } }
  );

  // Em produção o atalho não existe, e a rota volta a recusar com 503.
  await withServer(
    async ({ base }) => {
      const response = await fetch(`${base}/api/age/session`, {
        method: 'POST',
        ...bearer(VALID_TOKEN),
      });
      assert.equal(response.status, 503);
    },
    { ageVerified: false, ageOptions: { devAutoVerify: true, isProduction: true } }
  );
});

// ---- Termos (ADR-0016) ----

test('verificado mas sem aceitar os termos não vê o catálogo', async () => {
  await withServer(
    async ({ base }) => {
      for (const path of CATALOGO) {
        const response = await fetch(`${base}${path}`, bearer(VALID_TOKEN));
        const body = await response.json();
        assert.equal(response.status, 403, `${path} devia devolver 403`);
        assert.equal(body.error.code, 'TERMS_REQUIRED');
      }
    },
    { termsAccepted: false }
  );
});

test('aceitar os termos abre o catálogo, e o aceite fica registrado', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      const response = await fetch(`${base}/api/auth/accept-terms`, {
        method: 'POST',
        ...bearer(VALID_TOKEN),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        termsAccepted: true,
        acceptedAt: AGORA,
        versions: LEGAL,
      });

      // Uma linha por documento, com versão e data: é isso que responde
      // depois "o que esta pessoa aceitou, e quando".
      const aceites = await users.listAcceptances(userId);
      assert.equal(aceites.length, 2);
      assert.deepEqual(aceites.map((a) => a.document).sort(), ['privacidade', 'termos']);
      assert.ok(aceites.every((a) => a.accepted_at === AGORA));

      assert.equal((await fetch(`${base}/api/home`, bearer(VALID_TOKEN))).status, 200);
    },
    { termsAccepted: false }
  );
});

test('aceitar termos exige sessão, e não exige termos aceitos', async () => {
  await withServer(
    async ({ base }) => {
      // Sem token: 401, como qualquer rota de sessão.
      assert.equal(
        (await fetch(`${base}/api/auth/accept-terms`, { method: 'POST' })).status,
        401
      );
      // Com token e sem aceite: tem de passar, senão seria o cadeado
      // trancando a chave dentro.
      assert.equal(
        (
          await fetch(`${base}/api/auth/accept-terms`, {
            method: 'POST',
            ...bearer(VALID_TOKEN),
          })
        ).status,
        200
      );
    },
    { termsAccepted: false }
  );
});

test('/auth/me informa idade, termos e as versões vigentes', async () => {
  await withServer(async ({ base }) => {
    const me = await (await fetch(`${base}/api/auth/me`, bearer(VALID_TOKEN))).json();
    assert.equal(me.user.ageVerified, true);
    assert.equal(me.user.termsAccepted, true);
    assert.deepEqual(me.legalVersions, LEGAL);
    // O e-mail volta; a senha e o token não existem na resposta.
    assert.equal(me.user.email, EMAIL);
    assert.ok(!JSON.stringify(me).includes(VALID_TOKEN));
  });
});

test('a ordem das barreiras é idade e depois termos', async () => {
  // Sem nada: a primeira recusa é a de idade, não a de termos. A tela que a
  // pessoa vê primeiro é a de verificação.
  await withServer(
    async ({ base }) => {
      const response = await fetch(`${base}/api/home`, bearer(VALID_TOKEN));
      assert.equal((await response.json()).error.code, 'AGE_REQUIRED');
    },
    { ageVerified: false, termsAccepted: false }
  );
});
