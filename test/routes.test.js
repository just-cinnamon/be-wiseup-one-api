import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { unauthorized } from '../src/http/errors.js';
import { createModerationService } from '../src/services/moderationService.js';
import { fakeReports, fakeUsers } from './helpers.js';

/*
 * Testes de rota: quem passa e quem não passa (ADR-0012, ADR-0016, ADR-0019).
 *
 * Sem biblioteca de teste HTTP, que seria dependência nova (ADR-0003): o app
 * sobe numa porta livre (`listen(0)`) e o próprio `fetch` do Node chama.
 */

const VALID_TOKEN = 'token-de-sessao-valido';
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
 * aceita VALID_TOKEN. `ageVerified` decide se a conta nasce com a maioridade
 * já declarada.
 */
async function withServer(
  run,
  { ageVerified = true, termsAccepted = true, isAdmin = false } = {}
) {
  const users = fakeUsers();
  const { id } = await users.create({
    email: EMAIL,
    passwordHash: 'scrypt$fake',
    createdAt: AGORA,
  });

  if (ageVerified) {
    await users.declareAdult({ userId: id, declaredAt: AGORA, ip: '203.0.113.1' });
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
        isAdmin,
      };
    },
    login: async () => ({ user: { id, email: EMAIL }, token: VALID_TOKEN }),
    logout: async () => true,
    deleteAccount: async () => true,
    // A porta única do catálogo (ADR-0019): declara a maioridade e aceita os
    // documentos de uma vez.
    acceptGate: async ({ userId, ip }) => {
      await users.declareAdult({ userId, declaredAt: AGORA, ip });
      await aceitarTudo(userId);
      return {
        ageVerified: true,
        termsAccepted: true,
        acceptedAt: AGORA,
        versions: LEGAL,
      };
    },
  };

  // Moderação de verdade sobre um armazém falso (ADR-0017): o que está sendo
  // testado aqui é a rota, e trocar o serviço por um duplo deixaria de fora
  // justamente o acoplamento entre rota e regra.
  const reports = fakeReports();
  const moderation = createModerationService({ reports, now: () => new Date(AGORA) });

  // Registro de acesso falso (ADR-0018): o teste de rota verifica **quando** o
  // registro é escrito, não o SQL.
  const acessos = [];
  const accessLog = {
    record: async ({ userId, ip }) => (acessos.push({ userId, ip }), true),
  };

  const app = createApp({
    videosService: fakeVideosService,
    authService,
    moderation,
    accessLog,
    users,
    legalVersions: LEGAL,
    corsOrigins: ['http://localhost:5173'],
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    await run({
      base: `http://127.0.0.1:${server.address().port}`,
      users,
      userId: id,
      moderation,
      reports,
      acessos,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

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

// ---- Declaração de maioridade e termos (ADR-0019, ADR-0016) ----

test('logado sem declarar maioridade não vê nem miniatura', async () => {
  await withServer(
    async ({ base }) => {
      for (const path of CATALOGO) {
        const response = await fetch(`${base}${path}`, bearer(VALID_TOKEN));
        const body = await response.json();
        assert.equal(response.status, 403, `${path} devia devolver 403`);
        assert.equal(body.error.code, 'AGE_REQUIRED');
      }
    },
    { ageVerified: false, termsAccepted: false }
  );
});

test('não existe mais rota de provedor de idade', async () => {
  await withServer(async ({ base }) => {
    // O provedor saiu junto com a decisão (ADR-0019): nenhuma dessas rotas
    // pode continuar de pé, aceitando documento ou webhook de alguém.
    for (const path of ['/api/age/status', '/api/age/session', '/api/age/webhook']) {
      const response = await fetch(`${base}${path}`, bearer(VALID_TOKEN));
      assert.equal(response.status, 404, `${path} ainda responde`);
      assert.equal((await response.json()).error.code, 'ROUTE_NOT_FOUND');
    }
  });
});

test('um clique declara a maioridade e aceita os documentos', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      const response = await fetch(`${base}/api/auth/accept`, {
        method: 'POST',
        ...bearer(VALID_TOKEN),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ageVerified: true,
        termsAccepted: true,
        acceptedAt: AGORA,
        versions: LEGAL,
      });

      // O que ficou guardado: a declaração (quando, como, de qual IP) e uma
      // linha de aceite por documento. Nada de documento ou foto — não existe
      // coluna para isso.
      const conta = await users.findById(userId);
      assert.equal(conta.age_verified_at, AGORA);
      assert.equal(conta.age_method, 'autodeclaracao');
      assert.ok(conta.age_declared_ip, 'o IP da declaração é a evidência que existe');

      const aceites = await users.listAcceptances(userId);
      assert.equal(aceites.length, 2);
      assert.deepEqual(aceites.map((a) => a.document).sort(), ['privacidade', 'termos']);

      assert.equal((await fetch(`${base}/api/home`, bearer(VALID_TOKEN))).status, 200);
    },
    { ageVerified: false, termsAccepted: false }
  );
});

test('declarar exige sessão, e não exige idade nem termos', async () => {
  await withServer(
    async ({ base }) => {
      assert.equal(
        (await fetch(`${base}/api/auth/accept`, { method: 'POST' })).status,
        401,
        'sem token é 401, como qualquer rota de sessão'
      );
      // Com token e sem nada aceito, tem de passar: exigir idade declarada
      // para poder declarar a idade seria o cadeado trancando a chave dentro.
      assert.equal(
        (
          await fetch(`${base}/api/auth/accept`, {
            method: 'POST',
            ...bearer(VALID_TOKEN),
          })
        ).status,
        200
      );
    },
    { ageVerified: false, termsAccepted: false }
  );
});

test('declarar de novo não reescreve a declaração original', async () => {
  await withServer(
    async ({ base, users, userId }) => {
      const declarar = () =>
        fetch(`${base}/api/auth/accept`, { method: 'POST', ...bearer(VALID_TOKEN) });

      await declarar();
      const primeira = await users.findById(userId);
      await declarar();
      const segunda = await users.findById(userId);

      // A data que vale é a da primeira declaração: é ela que a pessoa fez.
      assert.equal(segunda.age_verified_at, primeira.age_verified_at);
      assert.equal(segunda.age_declared_ip, primeira.age_declared_ip);
      assert.equal(
        (await users.listAcceptances(userId)).length,
        2,
        'nem o aceite duplica'
      );
    },
    { ageVerified: false, termsAccepted: false }
  );
});

test('declarada a idade, falta de aceite ainda barra o catálogo', async () => {
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
  // Sem nada, a primeira recusa é a de idade. Como as duas são resolvidas na
  // mesma tela e no mesmo clique (ADR-0019), isso é detalhe de diagnóstico —
  // mas é o diagnóstico certo.
  await withServer(
    async ({ base }) => {
      const response = await fetch(`${base}/api/home`, bearer(VALID_TOKEN));
      assert.equal((await response.json()).error.code, 'AGE_REQUIRED');
    },
    { ageVerified: false, termsAccepted: false }
  );
});

// ---- Denúncia (ADR-0017) ----

const postJson = (token, body) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

test('denunciar exige sessão, idade e termos', async () => {
  await withServer(async ({ base }) => {
    const semToken = await fetch(
      `${base}/api/reports`,
      postJson(null, { videoId: 'v1', reason: 'menor' })
    );
    assert.equal(semToken.status, 401);
  });

  await withServer(
    async ({ base }) => {
      const response = await fetch(
        `${base}/api/reports`,
        postJson(VALID_TOKEN, { videoId: 'v1', reason: 'menor' })
      );
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'AGE_REQUIRED');
    },
    { ageVerified: false }
  );

  await withServer(
    async ({ base }) => {
      const response = await fetch(
        `${base}/api/reports`,
        postJson(VALID_TOKEN, { videoId: 'v1', reason: 'menor' })
      );
      assert.equal((await response.json()).error.code, 'TERMS_REQUIRED');
    },
    { termsAccepted: false }
  );
});

test('denúncia de menor volta blocked: true, e o vídeo some do catálogo', async () => {
  await withServer(async ({ base, moderation, reports }) => {
    const response = await fetch(
      `${base}/api/reports`,
      postJson(VALID_TOKEN, { videoId: 'ph_abc123', reason: 'menor', note: 'urgente' })
    );

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.blocked, true);
    assert.ok(body.id, 'a resposta traz o id da denúncia');

    assert.equal(moderation.isBlocked('ph_abc123'), true);
    assert.equal(reports.reports[0].note, 'urgente');
    // A denúncia guarda quem denunciou, mas a resposta não devolve e-mail.
    assert.ok(!JSON.stringify(body).includes(EMAIL));

    // Que o vídeo bloqueado desapareça do catálogo e vire 404 no detalhe é
    // testado em `videosService.test.js`: aqui o serviço de catálogo é um
    // duplo, e afirmar isso contra ele não provaria nada.
  });
});

test('motivo fora da lista é 400, e a lista de motivos é servida pela API', async () => {
  await withServer(async ({ base, reports }) => {
    const ruim = await fetch(
      `${base}/api/reports`,
      postJson(VALID_TOKEN, { videoId: 'v1', reason: 'nao_gostei' })
    );
    assert.equal(ruim.status, 400);
    assert.equal((await ruim.json()).error.code, 'INVALID_PARAMS');
    assert.equal(reports.reports.length, 0);

    // O front monta o formulário com esta lista: duas listas divergiriam.
    const motivos = await (
      await fetch(`${base}/api/reports/reasons`, bearer(VALID_TOKEN))
    ).json();
    assert.ok(motivos.reasons.includes('menor'));
    assert.ok(motivos.reasons.includes('sem_consentimento'));
  });
});

test('a 11ª denúncia na hora é 429', async () => {
  await withServer(async ({ base }) => {
    for (let i = 0; i < 10; i += 1) {
      const ok = await fetch(
        `${base}/api/reports`,
        postJson(VALID_TOKEN, { videoId: `video_${i}`, reason: 'outro' })
      );
      assert.equal(ok.status, 201);
    }
    const demais = await fetch(
      `${base}/api/reports`,
      postJson(VALID_TOKEN, { videoId: 'video_x', reason: 'outro' })
    );
    assert.equal(demais.status, 429);
    assert.equal((await demais.json()).error.code, 'TOO_MANY_REPORTS');
  });
});

test('as rotas de moderação exigem is_admin', async () => {
  const caminhos = [
    ['GET', '/api/reports/open'],
    ['GET', '/api/reports/blocked'],
  ];

  await withServer(async ({ base }) => {
    for (const [, path] of caminhos) {
      const response = await fetch(`${base}${path}`, bearer(VALID_TOKEN));
      assert.equal(response.status, 403, `${path} devia ser 403`);
      assert.equal((await response.json()).error.code, 'ADMIN_ONLY');
    }
    const review = await fetch(
      `${base}/api/reports/qualquer/review`,
      postJson(VALID_TOKEN, { procede: true })
    );
    assert.equal(review.status, 403);
    const block = await fetch(
      `${base}/api/reports/block`,
      postJson(VALID_TOKEN, { videoId: 'v1' })
    );
    assert.equal(block.status, 403);
  });
});

test('administrador vê a fila, decide e o vídeo sai do catálogo', async () => {
  await withServer(
    async ({ base, moderation }) => {
      const criada = await (
        await fetch(
          `${base}/api/reports`,
          postJson(VALID_TOKEN, { videoId: 'ph_xyz', reason: 'violencia' })
        )
      ).json();
      assert.equal(criada.blocked, false, 'violência não bloqueia antes da análise');

      const fila = await (
        await fetch(`${base}/api/reports/open`, bearer(VALID_TOKEN))
      ).json();
      assert.equal(fila.reports.length, 1);
      assert.equal(fila.reports[0].id, criada.id);

      const decisao = await fetch(
        `${base}/api/reports/${criada.id}/review`,
        postJson(VALID_TOKEN, { procede: true })
      );
      assert.equal(decisao.status, 200);
      assert.deepEqual(await decisao.json(), { status: 'procede', blocked: true });
      assert.equal(moderation.isBlocked('ph_xyz'), true);

      const bloqueados = await (
        await fetch(`${base}/api/reports/blocked`, bearer(VALID_TOKEN))
      ).json();
      assert.equal(bloqueados.blocked[0].video_id, 'ph_xyz');

      // A fila esvaziou: denúncia analisada não volta.
      const depois = await (
        await fetch(`${base}/api/reports/open`, bearer(VALID_TOKEN))
      ).json();
      assert.equal(depois.reports.length, 0);
    },
    { isAdmin: true }
  );
});

test('procede sem corpo é improcede: a decisão tem de ser explícita', async () => {
  await withServer(
    async ({ base, moderation }) => {
      const { id } = await (
        await fetch(
          `${base}/api/reports`,
          postJson(VALID_TOKEN, { videoId: 'ph_sem_corpo', reason: 'outro' })
        )
      ).json();

      const decisao = await fetch(`${base}/api/reports/${id}/review`, {
        method: 'POST',
        ...bearer(VALID_TOKEN),
      });
      assert.deepEqual(await decisao.json(), { status: 'improcede', blocked: false });
      assert.equal(moderation.isBlocked('ph_sem_corpo'), false);
    },
    { isAdmin: true }
  );
});

// ---- Registro de acesso (ADR-0018) ----

test('o login grava um registro de acesso; o resto da navegação não', async () => {
  await withServer(async ({ base, acessos, userId }) => {
    assert.equal(acessos.length, 0, 'nada antes de entrar');

    await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'qualquer' }),
    });

    assert.equal(acessos.length, 1);
    assert.equal(acessos[0].userId, userId);
    assert.ok(acessos[0].ip, 'o IP de quem chamou vai no registro');

    // Navegar pelo catálogo não gera registro: uma linha por login é registro
    // de acesso, uma linha por requisição seria rastro de navegação.
    await fetch(`${base}/api/home`, bearer(VALID_TOKEN));
    await fetch(`${base}/api/videos?q=qualquer`, bearer(VALID_TOKEN));
    await fetch(`${base}/api/videos/abc`, bearer(VALID_TOKEN));
    assert.equal(acessos.length, 1, 'nenhuma requisição de catálogo virou registro');
  });
});
