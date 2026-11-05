import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/db/database.js';
import { createAuthService } from '../src/services/authService.js';
import { createUsersService } from '../src/services/usersService.js';

const SENHA = 'segredo123';
const EMAIL = 'ana@wiseup.test';
const CAPTCHA = 'x'.repeat(300);

/**
 * Monta o serviço com banco em memória, captcha falso e relógio controlado.
 * `captcha` decide o que o siteverify responderia; `clock` move o tempo.
 */
async function setup({ captcha = true, lockMinutes = 15, maxAttempts = 5 } = {}) {
  const db = openDatabase(':memory:');
  const users = createUsersService({ db });
  let current = new Date('2026-11-05T12:00:00.000Z');
  const captchaCalls = [];

  const authService = createAuthService({
    users,
    captchaService: {
      verify: async (token) => (captchaCalls.push(token), captcha),
    },
    sessionTtlHours: 12,
    maxAttempts,
    lockMinutes,
    now: () => current,
  });

  await authService.seedUsers([{ email: EMAIL, password: SENHA }]);

  return {
    db,
    users,
    authService,
    captchaCalls,
    avanca: (minutos) => {
      current = new Date(current.getTime() + minutos * 60 * 1000);
    },
    login: (body) => authService.login({ email: EMAIL, captchaToken: CAPTCHA, ...body }),
  };
}

/** Executa a função e devolve o erro que ela lançou. */
async function erroDe(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('esperava um erro, mas não houve nenhum');
}

test('seedUsers cria as contas uma vez só', async () => {
  const { authService, users } = await setup();
  assert.ok(users.findByEmail(EMAIL));

  const criadas = await authService.seedUsers([
    { email: EMAIL, password: SENHA },
    { email: 'bia@wiseup.test', password: 'outra456' },
  ]);
  assert.equal(criadas, 1, 'só a conta que faltava');
  assert.ok(users.findByEmail('bia@wiseup.test'));
});

test('a senha não é guardada em claro', async () => {
  const { users } = await setup();
  const user = users.findByEmail(EMAIL);
  assert.ok(user.password_hash.startsWith('scrypt$'));
  assert.ok(!user.password_hash.includes(SENHA));
});

test('login devolve usuário, token e validade', async () => {
  const { login } = await setup();
  const result = await login({ password: SENHA });

  assert.equal(result.user.email, EMAIL);
  assert.ok(result.user.id);
  assert.ok(result.token.length >= 40);
  assert.equal(result.expiresAt, '2026-11-06T00:00:00.000Z');
  // O token em claro não pode aparecer na resposta de nenhum outro campo.
  assert.ok(!JSON.stringify(result.user).includes(result.token));
});

test('login aceita e-mail com maiúsculas e espaços', async () => {
  const { authService } = await setup();
  const result = await authService.login({
    email: `  ANA@Wiseup.Test  `,
    password: SENHA,
    captchaToken: CAPTCHA,
  });
  assert.equal(result.user.email, EMAIL);
});

test('senha errada e e-mail inexistente dão a mesma resposta', async () => {
  const { login } = await setup();

  const senhaErrada = await erroDe(() => login({ password: 'errada!!' }));
  const semConta = await erroDe(() =>
    login({ email: 'ninguem@wiseup.test', password: SENHA })
  );

  assert.equal(senhaErrada.status, 401);
  assert.equal(senhaErrada.code, 'INVALID_CREDENTIALS');
  assert.equal(semConta.status, senhaErrada.status);
  assert.equal(semConta.code, senhaErrada.code);
  assert.equal(semConta.message, senhaErrada.message);
  assert.equal(semConta.message, 'E-mail ou senha incorretos.');
});

test('o captcha é conferido antes da senha', async () => {
  const { login, captchaCalls } = await setup({ captcha: false });

  const erro = await erroDe(() => login({ password: SENHA }));
  assert.equal(erro.status, 400);
  assert.equal(erro.code, 'CAPTCHA_FAILED');
  assert.deepEqual(captchaCalls, [CAPTCHA]);
});

test('formato inválido é recusado antes do captcha', async () => {
  const { authService, captchaCalls } = await setup();
  const corpos = [
    {},
    { email: 'sem-arroba', password: SENHA, captchaToken: CAPTCHA },
    { email: EMAIL, password: 'abc', captchaToken: CAPTCHA }, // curta demais
    { email: EMAIL, password: SENHA }, // sem captcha
    { email: EMAIL, password: 'x'.repeat(201), captchaToken: CAPTCHA },
    { email: `${'a'.repeat(160)}@wiseup.test`, password: SENHA, captchaToken: CAPTCHA },
  ];

  for (const body of corpos) {
    const erro = await erroDe(() => authService.login(body));
    assert.equal(erro.status, 400, JSON.stringify(Object.keys(body)));
    assert.equal(erro.code, 'INVALID_PARAMS');
  }
  assert.equal(captchaCalls.length, 0, 'não chega a chamar o captcha');
});

test('bloqueia no 5º erro e libera depois do prazo', async () => {
  const { login, avanca } = await setup();

  for (let tentativa = 1; tentativa <= 4; tentativa += 1) {
    const erro = await erroDe(() => login({ password: 'errada!!' }));
    assert.equal(erro.code, 'INVALID_CREDENTIALS', `tentativa ${tentativa}`);
  }

  const quinta = await erroDe(() => login({ password: 'errada!!' }));
  assert.equal(quinta.status, 429);
  assert.equal(quinta.code, 'TOO_MANY_ATTEMPTS');

  // Bloqueado, a senha certa também não entra.
  const bloqueado = await erroDe(() => login({ password: SENHA }));
  assert.equal(bloqueado.status, 429);

  // Passados os 15 minutos, a senha certa entra e o contador zera.
  avanca(16);
  const result = await login({ password: SENHA });
  assert.equal(result.user.email, EMAIL);

  for (let tentativa = 1; tentativa <= 4; tentativa += 1) {
    const erro = await erroDe(() => login({ password: 'errada!!' }));
    assert.equal(erro.code, 'INVALID_CREDENTIALS', `pós-bloqueio ${tentativa}`);
  }
});

test('login certo zera o contador de erros', async () => {
  const { login, users } = await setup();

  await erroDe(() => login({ password: 'errada!!' }));
  await erroDe(() => login({ password: 'errada!!' }));
  assert.equal(Number(users.findByEmail(EMAIL).failed_count), 2);

  await login({ password: SENHA });
  const user = users.findByEmail(EMAIL);
  assert.equal(Number(user.failed_count), 0);
  assert.equal(user.locked_until, null);
});

test('token válido vira usuário; token inválido dá 401', async () => {
  const { login, authService } = await setup();
  const { token, user } = await login({ password: SENHA });

  assert.deepEqual(authService.getSessionUser(token), { id: user.id, email: EMAIL });

  for (const ruim of ['', 'curto', `${token}x`, null, undefined, 'y'.repeat(201)]) {
    const erro = await erroDe(async () => authService.getSessionUser(ruim));
    assert.equal(erro.status, 401);
    assert.equal(erro.code, 'UNAUTHORIZED');
  }
});

test('o token guardado no banco é o sha256, não o original', async () => {
  const { login, db } = await setup();
  const { token } = await login({ password: SENHA });

  const linha = db.prepare('SELECT token_hash FROM sessions').get();
  assert.notEqual(linha.token_hash, token);
  assert.match(linha.token_hash, /^[0-9a-f]{64}$/);
});

test('logout invalida a sessão e não mexe nas outras', async () => {
  const { login, authService } = await setup();
  const primeira = await login({ password: SENHA });
  const segunda = await login({ password: SENHA });

  assert.equal(authService.logout(primeira.token), true);
  const erro = await erroDe(async () => authService.getSessionUser(primeira.token));
  assert.equal(erro.status, 401);

  // A outra sessão do mesmo usuário continua de pé.
  assert.equal(authService.getSessionUser(segunda.token).email, EMAIL);
  // Repetir o logout não quebra, só não acha nada para apagar.
  assert.equal(authService.logout(primeira.token), false);
});

test('sessão expirada é recusada e sai do banco', async () => {
  const { login, authService, avanca, db } = await setup();
  const { token } = await login({ password: SENHA });

  avanca(12 * 60 + 1); // TTL de 12 horas
  const erro = await erroDe(async () => authService.getSessionUser(token));
  assert.equal(erro.status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
});

test('excluir a conta apaga as sessões junto', async () => {
  const { login, authService, users, db } = await setup();
  const { token, user } = await login({ password: SENHA });

  assert.equal(authService.deleteAccount(user.id), true);
  assert.equal(users.findByEmail(EMAIL), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);

  const erro = await erroDe(async () => authService.getSessionUser(token));
  assert.equal(erro.status, 401);

  // E o login da conta excluída responde como qualquer e-mail inexistente.
  const semConta = await erroDe(() => login({ password: SENHA }));
  assert.equal(semConta.code, 'INVALID_CREDENTIALS');
});
