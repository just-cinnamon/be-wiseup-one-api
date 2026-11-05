import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeVerify, hash, verify } from '../src/services/password.js';

test('o hash nunca é igual para a mesma senha, por causa do sal', async () => {
  const [a, b] = await Promise.all([hash('segredo123'), hash('segredo123')]);
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  // A senha em claro não aparece em nenhum lugar do hash.
  assert.ok(!a.includes('segredo123'));
});

test('verify aceita a senha certa e recusa a errada', async () => {
  const stored = await hash('segredo123');
  assert.equal(await verify('segredo123', stored), true);
  assert.equal(await verify('segredo124', stored), false);
  assert.equal(await verify('', stored), false);
  assert.equal(await verify('SEGREDO123', stored), false);
});

test('verify recusa hash corrompido sem lançar', async () => {
  const stored = await hash('segredo123');
  const corrompidos = [
    '',
    'scrypt',
    'bcrypt$16384$8$1$c2Fs$aGFzaA==',
    'scrypt$16384$8$1$c2Fs', // falta o hash
    `${stored}$extra`,
    stored.replace('16384', '0'), // parâmetro inválido
    stored.slice(0, -4), // hash truncado
    null,
    undefined,
    42,
  ];
  for (const valor of corrompidos) {
    assert.equal(await verify('segredo123', valor), false, `deveria recusar: ${valor}`);
  }
});

test('verify respeita os parâmetros gravados no hash, não os de hoje', async () => {
  // Hash gerado com N=1024: subir o custo no futuro não pode invalidar senha antiga.
  const barato = await import('node:crypto').then(({ scryptSync, randomBytes }) => {
    const salt = randomBytes(32);
    const derived = scryptSync('segredo123', salt, 64, { N: 1024, r: 8, p: 1 });
    return `scrypt$1024$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
  });
  assert.equal(await verify('segredo123', barato), true);
  assert.equal(await verify('outra', barato), false);
});

test('fakeVerify sempre devolve false e aceita entrada estranha', async () => {
  assert.equal(await fakeVerify('qualquer'), false);
  assert.equal(await fakeVerify(undefined), false);
});
