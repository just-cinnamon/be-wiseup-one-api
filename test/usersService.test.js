import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { createDatabase } from '../src/db/database.js';
import { createAccessLogService } from '../src/services/accessLogService.js';
import { createUsersService } from '../src/services/usersService.js';

/*
 * O SQL de verdade, contra um Postgres de verdade (ADR-0013).
 *
 * Roda só quando existe TEST_DATABASE_URL — num banco de teste, porque apaga o
 * que cria. Sem a variável, os testes são pulados em vez de falharem: ninguém
 * deve precisar de um servidor de banco de pé para rodar `npm test`.
 *
 * O que é regra de negócio (bloqueio, captcha, validade de sessão) está em
 * `authService.test.js`, com o `users` falso de `helpers.js`.
 *
 *   docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:17
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm test
 */

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'defina TEST_DATABASE_URL para exercitar o SQL';

// Prefixo por execução: duas rodadas em paralelo não se atrapalham, e sobra
// identificável se algo falhar no meio.
const PREFIXO = `teste-${randomUUID().slice(0, 8)}`;
const email = (nome) => `${PREFIXO}-${nome}@wiseup.test`;

const AGORA = '2026-11-05T12:00:00.000Z';

let db = null;
const abrir = async () => {
  if (!db) {
    db = createDatabase({ connectionString: url, max: 2 });
    await db.applySchema();
  }
  return db;
};

after(async () => {
  if (!db) return;
  // As sessões vão junto, por ON DELETE CASCADE — que é justamente o que o
  // último teste confere.
  await db.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIXO}-%`]);
  await db.close();
});

test('cria a conta e acha pelo e-mail', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const criado = await users.create({
    email: email('ana'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });

  const achado = await users.findByEmail(email('ana'));
  assert.equal(achado.id, criado.id);
  assert.equal(achado.failed_count, 0);
  assert.equal(achado.locked_until, null);
  assert.equal(await users.findByEmail(email('ninguem')), undefined);
});

test('o UNIQUE de e-mail é do banco, não da aplicação', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const dados = {
    email: email('bia'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  };
  await users.create(dados);

  // Duas requisições simultâneas passariam juntas por um `if` na aplicação; o
  // UNIQUE não deixa, e é por isso que ele existe.
  await assert.rejects(() => users.create(dados), /duplicate key|unique/i);
});

test('o bloqueio é gravado e lido como ISO 8601', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('cadu'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });

  await users.setLockState(id, {
    failedCount: 5,
    lockedUntil: '2026-11-05T12:15:00.000Z',
  });
  const bloqueado = await users.findByEmail(email('cadu'));
  assert.equal(Number(bloqueado.failed_count), 5);
  assert.equal(bloqueado.locked_until, '2026-11-05T12:15:00.000Z');

  await users.setLockState(id, { failedCount: 0, lockedUntil: null });
  const liberado = await users.findByEmail(email('cadu'));
  assert.equal(liberado.locked_until, null);
});

test('sessão: cria, acha com o e-mail junto, apaga', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('dani'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });

  await users.createSession({
    tokenHash: 'a'.repeat(64),
    userId: id,
    createdAt: '2026-11-05T12:00:00.000Z',
    expiresAt: '2026-11-06T00:00:00.000Z',
  });

  const sessao = await users.findSession('a'.repeat(64));
  assert.equal(sessao.email, email('dani'));
  assert.equal(sessao.expires_at, '2026-11-06T00:00:00.000Z');

  assert.equal(await users.removeSession('a'.repeat(64)), true);
  assert.equal(await users.removeSession('a'.repeat(64)), false);
  assert.equal(await users.findSession('a'.repeat(64)), undefined);
});

test('a faxina apaga só o que já venceu', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('edu'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });

  const sessao = (hash, expiresAt) =>
    users.createSession({
      tokenHash: hash,
      userId: id,
      createdAt: '2026-11-05T12:00:00.000Z',
      expiresAt,
    });

  await sessao('b'.repeat(64), '2026-11-05T11:00:00.000Z'); // vencida
  await sessao('c'.repeat(64), '2026-11-06T00:00:00.000Z'); // válida

  const apagadas = await users.removeExpiredSessions('2026-11-05T12:00:00.000Z');
  assert.equal(apagadas, 1);
  assert.equal(await users.findSession('b'.repeat(64)), undefined);
  assert.ok(await users.findSession('c'.repeat(64)));
});

test('apagar a conta leva as sessões por cascata', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('fabi'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });
  await users.createSession({
    tokenHash: 'd'.repeat(64),
    userId: id,
    createdAt: '2026-11-05T12:00:00.000Z',
    expiresAt: '2026-11-06T00:00:00.000Z',
  });

  assert.equal(await users.remove(id), true);
  assert.equal(await users.findByEmail(email('fabi')), undefined);
  // Sem o ON DELETE CASCADE do schema, esta linha continuaria no banco
  // apontando para uma conta que não existe mais.
  assert.equal(await users.findSession('d'.repeat(64)), undefined);
  assert.equal(await users.remove(id), false);
});

test('aceite de termos: uma linha por versão, sem duplicar', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('gi'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });

  const aceitar = (document, version, acceptedAt) =>
    users.acceptTerms({ userId: id, document, version, acceptedAt });

  await aceitar('termos', '2026-11-05', '2026-11-05T12:00:00.000Z');
  await aceitar('privacidade', '2026-11-05', '2026-11-05T12:00:00.000Z');
  // Repetir o mesmo aceite não cria linha nem reescreve a data original
  // (ON CONFLICT DO NOTHING): o histórico é do primeiro aceite.
  await aceitar('termos', '2026-11-05', '2026-12-01T00:00:00.000Z');

  const aceites = await users.listAcceptances(id);
  assert.equal(aceites.length, 2);
  const termos = aceites.find((a) => a.document === 'termos');
  assert.equal(termos.accepted_at, '2026-11-05T12:00:00.000Z');

  // Versão nova é outra linha: nada do que já foi aceito é apagado.
  await aceitar('termos', '2027-01-01', '2027-01-02T00:00:00.000Z');
  assert.equal((await users.listAcceptances(id)).length, 3);
});

test('a sessão conta os aceites da versão vigente', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('hugo'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });
  await users.createSession({
    tokenHash: 'e'.repeat(64),
    userId: id,
    createdAt: '2026-11-05T12:00:00.000Z',
    expiresAt: '2026-11-06T00:00:00.000Z',
  });

  const versoes = { termos: '2026-11-05', privacidade: '2026-11-05' };
  const contar = async () =>
    Number((await users.findSession('e'.repeat(64), versoes)).accepted_count);

  assert.equal(await contar(), 0);
  await users.acceptTerms({
    userId: id,
    document: 'termos',
    version: '2026-11-05',
    acceptedAt: '2026-11-05T12:00:00.000Z',
  });
  assert.equal(await contar(), 1, 'um documento só não basta');

  await users.acceptTerms({
    userId: id,
    document: 'privacidade',
    version: '2026-11-05',
    acceptedAt: '2026-11-05T12:00:00.000Z',
  });
  assert.equal(await contar(), 2);

  // Aceite de versão antiga não conta para a vigente.
  const antigas = { termos: '2020-01-01', privacidade: '2020-01-01' };
  assert.equal(
    Number((await users.findSession('e'.repeat(64), antigas)).accepted_count),
    0
  );
});

test('apagar a conta leva os aceites por cascata', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const { id } = await users.create({
    email: email('ian'),
    passwordHash: 'scrypt$fake',
    createdAt: '2026-11-05T12:00:00.000Z',
  });
  await users.acceptTerms({
    userId: id,
    document: 'termos',
    version: '2026-11-05',
    acceptedAt: '2026-11-05T12:00:00.000Z',
  });

  assert.equal(await users.remove(id), true);
  assert.deepEqual(await users.listAcceptances(id), []);
});

/*
 * O registro de acesso (ADR-0018) mora aqui porque depende da mesma conexão e
 * do mesmo ciclo de vida de conta: o que só o banco responde é se ele
 * **sobrevive** à exclusão da conta, que é a parte menos óbvia da decisão.
 */
test('o registro de acesso sobrevive à exclusão da conta', { skip }, async () => {
  const db = await abrir();
  const users = createUsersService({ db });
  const accessLog = createAccessLogService({ db, now: () => new Date(AGORA) });
  const { id } = await users.create({
    email: email('joana'),
    passwordHash: 'scrypt$fake',
    createdAt: AGORA,
  });

  assert.equal(await accessLog.record({ userId: id, ip: '203.0.113.9' }), true);
  assert.equal(await accessLog.countForUser(id), 1);

  await users.remove(id);

  // Sessões e aceites vão com a conta (CASCADE); o registro de acesso fica,
  // porque os seis meses do Marco Civil não dependem de a conta existir. É o
  // motivo de `user_id` ser TEXT sem chave estrangeira.
  assert.equal(
    await accessLog.countForUser(id),
    1,
    'o registro de acesso não é apagado com a conta'
  );

  await db.query(`DELETE FROM access_logs WHERE user_id = $1`, [id]);
});

test('a faxina apaga só o que passou do prazo', { skip }, async () => {
  const db = await abrir();
  const users = createUsersService({ db });
  const { id } = await users.create({
    email: email('kaio'),
    passwordHash: 'scrypt$fake',
    createdAt: AGORA,
  });

  const antigo = createAccessLogService({
    db,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  const recente = createAccessLogService({ db, now: () => new Date(AGORA) });
  await antigo.record({ userId: id, ip: '1.1.1.1' });
  await recente.record({ userId: id, ip: '2.2.2.2' });
  assert.equal(await recente.countForUser(id), 2);

  // Em 05/11/2026, o limite é 09/05/2026: o de janeiro sai, o de hoje fica.
  await recente.purge();
  assert.equal(await recente.countForUser(id), 1);

  await db.query(`DELETE FROM access_logs WHERE user_id = $1`, [id]);
});
