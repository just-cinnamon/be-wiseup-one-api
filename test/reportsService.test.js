import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { createDatabase } from '../src/db/database.js';
import { createReportsService } from '../src/services/reportsService.js';
import { createUsersService } from '../src/services/usersService.js';

/*
 * O SQL das denúncias e dos bloqueios (ADR-0017), contra um Postgres de
 * verdade. Mesma regra de `usersService.test.js`: sem TEST_DATABASE_URL, pula.
 *
 * O que é regra — motivos aceitos, limite por hora, o que bloqueia na hora —
 * está em `moderationService.test.js`, com o armazém falso. Aqui o que importa
 * é o que só o banco responde: a transação, o ON CONFLICT e o SET NULL.
 */

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'defina TEST_DATABASE_URL para exercitar o SQL';

const PREFIXO = `teste-${randomUUID().slice(0, 8)}`;
const AGORA = '2026-11-05T12:00:00.000Z';

let db = null;
const abrir = async () => {
  if (!db) {
    db = createDatabase({ connectionString: url, max: 2 });
    await db.applySchema();
  }
  return db;
};

/** Conta de teste; as denúncias dela saem no `after` junto com ela. */
async function contaDeTeste(nome) {
  const users = createUsersService({ db: await abrir() });
  return users.create({
    email: `${PREFIXO}-${nome}@wiseup.test`,
    passwordHash: 'scrypt$fake',
    createdAt: AGORA,
  });
}

after(async () => {
  if (!db) return;
  // `reports.user_id` é ON DELETE SET NULL: apagar a conta **não** apaga a
  // denúncia, então a limpeza tem de ser explícita pelo prefixo.
  await db.query(`DELETE FROM blocked_videos WHERE video_id LIKE $1`, [`${PREFIXO}%`]);
  await db.query(`DELETE FROM reports WHERE video_id LIKE $1`, [`${PREFIXO}%`]);
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIXO}%`]);
  await db.close();
});

test('denúncia de bloqueio imediato grava as duas linhas juntas', { skip }, async () => {
  const reports = createReportsService({ db: await abrir() });
  const { id: userId } = await contaDeTeste('ana');
  const videoId = `${PREFIXO}_v1`;
  const reportId = randomUUID();

  const resultado = await reports.createMaybeBlocking({
    id: reportId,
    videoId,
    userId,
    reason: 'menor',
    note: 'urgente',
    createdAt: AGORA,
    blockNow: true,
  });

  assert.deepEqual(resultado, { id: reportId, blocked: true });
  assert.ok((await reports.listBlockedIds()).includes(videoId));
  const gravada = await reports.findById(reportId);
  assert.equal(gravada.status, 'aberta', 'o vídeo sai antes da análise, não em vez dela');
  assert.equal(gravada.note, 'urgente');
});

test('a transação é tudo ou nada', { skip }, async () => {
  const reports = createReportsService({ db: await abrir() });
  const { id: userId } = await contaDeTeste('bruno');
  const videoId = `${PREFIXO}_v2`;
  const reportId = randomUUID();

  // Duas vezes o mesmo id de denúncia: a segunda viola a chave primária, e o
  // INSERT do bloqueio vem depois. Sem transação, o vídeo poderia ficar
  // bloqueado por uma denúncia que não existe.
  await reports.createMaybeBlocking({
    id: reportId,
    videoId: `${PREFIXO}_outro`,
    userId,
    reason: 'outro',
    note: null,
    createdAt: AGORA,
    blockNow: false,
  });

  await assert.rejects(() =>
    reports.createMaybeBlocking({
      id: reportId,
      videoId,
      userId,
      reason: 'menor',
      note: null,
      createdAt: AGORA,
      blockNow: true,
    })
  );

  assert.equal(
    (await reports.listBlockedIds()).includes(videoId),
    false,
    'o bloqueio foi desfeito com o ROLLBACK'
  );
});

test('bloquear duas vezes o mesmo vídeo mantém o primeiro motivo', { skip }, async () => {
  const reports = createReportsService({ db: await abrir() });
  const videoId = `${PREFIXO}_v3`;

  await reports.block({ videoId, reason: 'origem-removeu', blockedAt: AGORA });
  await reports.block({
    videoId,
    reason: 'admin',
    blockedAt: '2026-12-01T00:00:00.000Z',
  });

  const [bloqueio] = (await reports.listBlocked()).filter((b) => b.video_id === videoId);
  assert.equal(bloqueio.reason, 'origem-removeu');
  assert.equal(bloqueio.blocked_at, AGORA);
});

test('desbloqueio só desfaz o que veio daquela denúncia', { skip }, async () => {
  const reports = createReportsService({ db: await abrir() });
  const videoId = `${PREFIXO}_v4`;
  const reportId = randomUUID();

  await reports.block({ videoId, reason: 'admin', blockedAt: AGORA });
  assert.equal(
    await reports.unblockFromReport({ videoId, reportId }),
    false,
    'bloqueio manual não é desfeito por decisão de denúncia'
  );

  await reports.block({
    videoId: `${PREFIXO}_v5`,
    reason: 'denuncia',
    blockedAt: AGORA,
    reportId,
  });
  assert.equal(
    await reports.unblockFromReport({ videoId: `${PREFIXO}_v5`, reportId }),
    true
  );
});

test('analisar duas vezes não muda a decisão registrada', { skip }, async () => {
  const reports = createReportsService({ db: await abrir() });
  const { id: userId } = await contaDeTeste('carla');
  const reportId = randomUUID();

  await reports.createMaybeBlocking({
    id: reportId,
    videoId: `${PREFIXO}_v6`,
    userId,
    reason: 'violencia',
    note: null,
    createdAt: AGORA,
    blockNow: false,
  });

  assert.equal(
    await reports.review({
      id: reportId,
      status: 'procede',
      reviewedAt: AGORA,
      reviewedBy: 'admin1',
    }),
    true
  );
  assert.equal(
    await reports.review({
      id: reportId,
      status: 'improcede',
      reviewedAt: '2026-12-01T00:00:00.000Z',
      reviewedBy: 'admin2',
    }),
    false,
    'só denúncia aberta é analisada'
  );

  const final = await reports.findById(reportId);
  assert.equal(final.status, 'procede');
  assert.equal(final.reviewed_by, 'admin1');
});

test('apagar a conta não apaga a denúncia', { skip }, async () => {
  const users = createUsersService({ db: await abrir() });
  const reports = createReportsService({ db: await abrir() });
  const { id: userId } = await contaDeTeste('diego');
  const reportId = randomUUID();

  await reports.createMaybeBlocking({
    id: reportId,
    videoId: `${PREFIXO}_v7`,
    userId,
    reason: 'menor',
    note: null,
    createdAt: AGORA,
    blockNow: true,
  });

  await users.remove(userId);

  const sobreviveu = await reports.findById(reportId);
  assert.ok(sobreviveu, 'a denúncia é sobre o vídeo, não sobre quem denunciou');
  assert.equal(sobreviveu.user_id, null, 'o vínculo com a conta vira NULL');
  assert.ok((await reports.listBlockedIds()).includes(`${PREFIXO}_v7`));
});

test('o limite por hora conta pela data', { skip }, async () => {
  const reports = createReportsService({ db: await abrir() });
  const { id: userId } = await contaDeTeste('elisa');

  const datas = [
    '2026-11-05T10:00:00.000Z',
    '2026-11-05T11:59:00.000Z',
    '2026-11-05T12:00:00.000Z',
  ];
  for (const [i, data] of datas.entries()) {
    await reports.createMaybeBlocking({
      id: randomUUID(),
      videoId: `${PREFIXO}_h${i}`,
      userId,
      reason: 'outro',
      note: null,
      createdAt: data,
      blockNow: false,
    });
  }

  assert.equal(await reports.countByUserSince(userId, '2026-11-05T11:00:00.000Z'), 2);
  assert.equal(await reports.countByUserSince(userId, '2026-11-05T09:00:00.000Z'), 3);
});
