import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccessLogService } from '../src/services/accessLogService.js';

/*
 * O registro de acesso (ADR-0018) com um `db` falso: o que se verifica aqui é
 * **o que entra na tabela** e o que nunca pode entrar. O SQL de verdade é um
 * INSERT e um DELETE por data, exercitados em `usersService.test.js` pela
 * mesma conexão.
 */

const AGORA = new Date('2026-11-05T12:00:00.000Z');

function fakeDb() {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text, params });
      if (text.includes('DELETE')) return { rowCount: 3 };
      if (text.includes('COUNT')) return { rows: [{ total: 1 }] };
      return { rows: [] };
    },
  };
}

test('o login grava quem entrou, de qual IP e quando — e nada mais', async () => {
  const db = fakeDb();
  const accessLog = createAccessLogService({ db, now: () => AGORA });

  assert.equal(await accessLog.record({ userId: 'u1', ip: '203.0.113.7' }), true);

  const [{ text, params }] = db.queries;
  assert.match(text, /INSERT INTO access_logs/);
  assert.deepEqual(params, ['u1', '203.0.113.7', '2026-11-05T12:00:00.000Z']);
  // Três colunas, três parâmetros: busca, vídeo assistido e navegador não têm
  // onde entrar, e é essa a decisão.
  assert.equal(params.length, 3);
});

test('sem IP, grava NULL em vez de inventar', async () => {
  const db = fakeDb();
  const accessLog = createAccessLogService({ db, now: () => AGORA });
  await accessLog.record({ userId: 'u1' });
  assert.equal(db.queries[0].params[1], null);
});

test('falha ao gravar não impede o login', async () => {
  const db = {
    query: async () => {
      throw new Error('banco fora do ar');
    },
  };
  const accessLog = createAccessLogService({ db, now: () => AGORA });

  // Não lança: a rota de login chama isto depois de autenticar, e uma falha
  // aqui deixando alguém de fora da conta seria o remédio pior que a doença.
  assert.equal(await accessLog.record({ userId: 'u1', ip: '1.2.3.4' }), false);
});

test('a faxina apaga pelo prazo de seis meses', async () => {
  const db = fakeDb();
  const accessLog = createAccessLogService({ db, now: () => AGORA });

  assert.equal(await accessLog.purge(), 3);

  const [{ text, params }] = db.queries;
  assert.match(text, /DELETE FROM access_logs WHERE accessed_at < \$1/);
  // 180 dias antes de 05/11/2026.
  assert.equal(params[0], '2026-05-09T12:00:00.000Z');
});

test('o prazo é configurável, e é o único jeito de mudá-lo', async () => {
  const db = fakeDb();
  const accessLog = createAccessLogService({
    db,
    now: () => AGORA,
    retentionDays: 30,
  });
  await accessLog.purge();
  assert.equal(db.queries[0].params[0], '2026-10-06T12:00:00.000Z');
});
