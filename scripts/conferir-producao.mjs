#!/usr/bin/env node
/*
 * Confere, de fora, se a API publicada é esta versão e se as barreiras estão
 * de pé. Serve para o depois do deploy: a build nova só sobe com
 * `DATABASE_URL` cadastrada, e sem ela o Render mantém no ar a build anterior
 * — que não tem nenhuma das barreiras. Dá para olhar o painel e não perceber.
 *
 * Uso (PowerShell):
 *   node scripts/conferir-producao.mjs https://be-wiseup-one-api.onrender.com
 *   node scripts/conferir-producao.mjs https://... email@dominio.com senha
 *
 * Sem e-mail e senha, roda só as checagens que não precisam de conta.
 * Devolve código de saída 1 se qualquer checagem falhar, para servir em CI.
 *
 * O plano gratuito do Render hiberna: a primeira chamada pode levar um minuto.
 */

const [, , baseArg, email, senha] = process.argv;

if (!baseArg) {
  console.error('Uso: node scripts/conferir-producao.mjs <url-da-api> [email] [senha]');
  process.exit(2);
}

const base = `${baseArg.replace(/\/+$/, '')}/api`;
const TIMEOUT_MS = 75_000;

let falhas = 0;

/** Imprime o resultado de uma checagem e conta as falhas. */
function resultado(ok, titulo, detalhe = '') {
  console.log(`${ok ? '  ok  ' : 'FALHOU'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas += 1;
}

async function chamar(caminho, options = {}) {
  const resposta = await fetch(`${base}${caminho}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const corpo = await resposta.json().catch(() => null);
  return { status: resposta.status, corpo };
}

console.log(`\nConferindo ${base}\n`);

// 1. O serviço responde.
try {
  const { status, corpo } = await chamar('/health');
  resultado(
    status === 200 && corpo?.status === 'ok',
    'o serviço responde',
    `HTTP ${status}`
  );
} catch (erro) {
  resultado(false, 'o serviço responde', erro.message);
  console.error('\nSem resposta do serviço: o resto não faz sentido conferir.\n');
  process.exit(1);
}

// 2. Catálogo fechado sem sessão (ADR-0012). É a checagem mais importante
//    daqui: se isto passar com 200, o catálogo adulto está aberto a qualquer
//    pessoa com a URL, e a build no ar é antiga.
{
  const { status, corpo } = await chamar('/videos');
  resultado(
    status === 401,
    'catálogo fechado sem sessão',
    `HTTP ${status}${status === 200 ? ' — CATÁLOGO ABERTO: a build no ar é antiga' : ''}`
  );
  if (status === 200 && Array.isArray(corpo?.items)) {
    console.log(`        (devolveu ${corpo.items.length} títulos sem token)`);
  }
}

/*
 * 3. As rotas do provedor de idade não existem mais (ADR-0019).
 *
 * Sem token esta checagem é **inconclusiva**: `requireAuth` responde 401 antes
 * de o roteador chegar ao 404, e a rota antiga também exigia sessão — os dois
 * casos dão 401. Com token, o 404 é prova. A checagem conclusiva está no fim,
 * depois do login.
 */
{
  const { status } = await chamar('/age/session', { method: 'POST' });
  resultado(
    status === 404 || status === 401,
    'rotas do provedor de idade: sem sessão não responde',
    `HTTP ${status}${status === 401 ? ' (conclusivo só com e-mail e senha)' : ''}`
  );
}

// 4. A porta única existe e exige sessão (ADR-0019).
{
  const { status, corpo } = await chamar('/auth/accept', { method: 'POST' });
  resultado(
    status === 401,
    'POST /auth/accept existe e exige sessão',
    `HTTP ${status}${status === 404 ? ' — rota ausente: build antiga' : ''}` +
      (corpo?.error?.code ? ` (${corpo.error.code})` : '')
  );
}

// 5. Senha errada não entra. Usa um e-mail que ninguém cadastraria.
{
  const { status, corpo } = await chamar('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'conta-que-nao-existe@wiseup.test',
      password: 'senha-errada-de-proposito',
    }),
  });
  const codigo = corpo?.error?.code ?? '';
  resultado(
    status === 401,
    'credencial inválida não entra',
    `HTTP ${status}${codigo ? ` (${codigo})` : ''}` +
      (codigo === 'INVALID_PARAMS' ? ' — pedindo captcha: build antiga' : '')
  );
}

if (!email || !senha) {
  console.log('\nSem e-mail e senha: as checagens com conta foram puladas.');
  console.log(
    'Para rodá-las: node scripts/conferir-producao.mjs <url> <email> <senha>\n'
  );
  process.exit(falhas ? 1 : 0);
}

// 6. A conta do SEED_USERS entra, e já se sabe se ela declarou idade.
let token = null;
{
  const { status, corpo } = await chamar('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  token = corpo?.token ?? null;
  resultado(
    status === 200 && Boolean(token),
    'a conta informada entra',
    `HTTP ${status}` + (corpo?.error?.code ? ` (${corpo.error.code})` : '')
  );
  if (corpo?.user) {
    console.log(
      `        idade declarada: ${corpo.user.ageVerified ? 'sim' : 'não'} · termos aceitos: ${
        corpo.user.termsAccepted ? 'sim' : 'não'
      }`
    );
  }
}

if (!token) {
  console.log('\nSem token: o resto depende do login.\n');
  process.exit(1);
}

const comToken = { headers: { Authorization: `Bearer ${token}` } };

// 7. Com sessão e sem declaração de idade, o catálogo continua fechado.
{
  const { status, corpo } = await chamar('/videos', comToken);
  const codigo = corpo?.error?.code ?? '';
  const esperado = status === 200 || (status === 403 && codigo === 'AGE_REQUIRED');
  resultado(
    esperado,
    'com sessão: catálogo abre, ou pede a confirmação +18',
    `HTTP ${status}${codigo ? ` (${codigo})` : ''}`
  );
}

// 8. A porta única registra as duas coisas de uma vez.
{
  const { status, corpo } = await chamar('/auth/accept', { method: 'POST', ...comToken });
  resultado(
    status === 200 && corpo?.ageVerified === true && corpo?.termsAccepted === true,
    'a confirmação registra idade e termos juntos',
    `HTTP ${status}`
  );
  if (corpo?.acceptedAt) console.log(`        registrado em ${corpo.acceptedAt}`);
}

// 9. Depois da confirmação, o catálogo abre.
{
  const { status, corpo } = await chamar('/videos', comToken);
  resultado(
    status === 200 && Array.isArray(corpo?.items),
    'depois da confirmação, o catálogo abre',
    `HTTP ${status}`
  );
}

// 10. Agora sim, com sessão: a rota do provedor de idade tem de dar 404.
{
  const { status } = await chamar('/age/session', { method: 'POST', ...comToken });
  resultado(
    status === 404,
    'com sessão: rota do provedor de idade removida',
    `HTTP ${status}${status === 200 || status === 503 ? ' — o adaptador antigo ainda está no ar' : ''}`
  );
}

console.log(
  falhas
    ? `\n${falhas} checagem(ns) falharam.\n`
    : '\nTudo certo: a build no ar é esta, e as barreiras estão de pé.\n'
);
process.exit(falhas ? 1 : 0);
