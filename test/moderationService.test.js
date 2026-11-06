import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createModerationService,
  IMMEDIATE_BLOCK,
  REASONS,
} from '../src/services/moderationService.js';
import { fakeReports } from './helpers.js';

const AGORA = new Date('2026-11-05T12:00:00.000Z');
const VIDEO = 'ph5fd1234abcd';
const USER = 'u1';

function setup({ now = () => AGORA, client = null } = {}) {
  const reports = fakeReports();
  const moderation = createModerationService({ reports, client, now });
  return { reports, moderation };
}

const denunciar = (moderation, body) => moderation.report({ userId: USER, body });

test('denúncia de menor tira o vídeo do ar na hora', async () => {
  const { moderation, reports } = setup();

  const resultado = await denunciar(moderation, { videoId: VIDEO, reason: 'menor' });

  assert.equal(resultado.blocked, true, 'a resposta diz ao front para sumir o card');
  assert.equal(moderation.isBlocked(VIDEO), true);
  assert.equal(reports.blocked.get(VIDEO).reason, 'denuncia');
  // A denúncia continua aberta: o vídeo sai antes da análise, e não em vez
  // dela.
  assert.equal(reports.reports[0].status, 'aberta');
});

test('sem_consentimento também bloqueia na hora; os outros motivos não', async () => {
  for (const reason of REASONS) {
    const { moderation } = setup();
    const { blocked } = await denunciar(moderation, { videoId: VIDEO, reason });
    assert.equal(
      blocked,
      IMMEDIATE_BLOCK.includes(reason),
      `motivo ${reason} bloqueou ${blocked}`
    );
    assert.equal(moderation.isBlocked(VIDEO), IMMEDIATE_BLOCK.includes(reason));
  }
});

test('a denúncia guarda motivo, observação e quem denunciou', async () => {
  const { moderation, reports } = setup();
  await denunciar(moderation, {
    videoId: VIDEO,
    reason: 'violencia',
    note: '  cena aos 2min  ',
  });

  const [report] = reports.reports;
  assert.equal(report.video_id, VIDEO);
  assert.equal(report.user_id, USER);
  assert.equal(report.reason, 'violencia');
  assert.equal(report.note, 'cena aos 2min', 'a observação chega sem espaços nas pontas');
  assert.equal(report.created_at, AGORA.toISOString());
});

test('motivo fora da lista, vídeo inválido e observação longa dão 400', async () => {
  const { moderation } = setup();

  const invalido = async (body, oque) => {
    await assert.rejects(() => denunciar(moderation, body), { status: 400 }, oque);
  };

  await invalido({ videoId: VIDEO, reason: 'nao_gostei' }, 'motivo inventado');
  await invalido({ videoId: VIDEO, reason: '' }, 'motivo vazio');
  await invalido({ videoId: 'id com espaço', reason: 'menor' }, 'id fora do padrão');
  await invalido({ videoId: '', reason: 'menor' }, 'id vazio');
  await invalido(
    { videoId: VIDEO, reason: 'outro', note: 'x'.repeat(501) },
    'observação de 501 caracteres'
  );

  // Nada foi gravado, e nada foi bloqueado: validação antes de escrever.
  assert.equal(moderation.isBlocked(VIDEO), false);
});

test('mais de 10 denúncias em uma hora é 429, e a 11ª não bloqueia nada', async () => {
  const { moderation, reports } = setup();

  for (let i = 0; i < 10; i += 1) {
    await denunciar(moderation, { videoId: `video_${i}`, reason: 'outro' });
  }
  await assert.rejects(
    () => denunciar(moderation, { videoId: 'video_novo', reason: 'menor' }),
    { status: 429, code: 'TOO_MANY_REPORTS' }
  );

  assert.equal(reports.reports.length, 10);
  assert.equal(
    moderation.isBlocked('video_novo'),
    false,
    'nem a denúncia de menor passa do limite: o limite existe para não dar para ' +
      'uma conta sozinha limpar o catálogo'
  );
});

test('o limite é de uma hora, não do dia', async () => {
  let agora = new Date('2026-11-05T12:00:00.000Z');
  const { moderation } = setup({ now: () => agora });

  for (let i = 0; i < 10; i += 1) {
    await denunciar(moderation, { videoId: `video_${i}`, reason: 'outro' });
  }
  await assert.rejects(() => denunciar(moderation, { videoId: 'v', reason: 'outro' }), {
    status: 429,
  });

  agora = new Date('2026-11-05T13:00:01.000Z');
  const { blocked } = await denunciar(moderation, { videoId: 'v', reason: 'outro' });
  assert.equal(blocked, false);
});

// ---- Análise ----

test('procede bloqueia; analisar duas vezes a mesma denúncia dá 400', async () => {
  const { moderation, reports } = setup();
  const { id } = await denunciar(moderation, { videoId: VIDEO, reason: 'violencia' });
  assert.equal(moderation.isBlocked(VIDEO), false);

  const decisao = await moderation.review({ id, procede: true, adminId: 'admin1' });
  assert.deepEqual(decisao, { status: 'procede', blocked: true });
  assert.equal(moderation.isBlocked(VIDEO), true);
  assert.equal(reports.reports[0].reviewed_by, 'admin1');
  assert.equal(reports.reports[0].reviewed_at, AGORA.toISOString());

  await assert.rejects(
    () => moderation.review({ id, procede: false, adminId: 'admin1' }),
    { status: 400 },
    'denúncia já analisada não volta para a fila'
  );
});

test('improcede devolve ao ar só o que esta denúncia bloqueou', async () => {
  const { moderation } = setup();
  const { id } = await denunciar(moderation, { videoId: VIDEO, reason: 'menor' });
  assert.equal(moderation.isBlocked(VIDEO), true);

  const decisao = await moderation.review({ id, procede: false, adminId: 'admin1' });
  assert.deepEqual(decisao, { status: 'improcede', blocked: false });
  assert.equal(moderation.isBlocked(VIDEO), false);
});

test('improcede não desfaz bloqueio de outra denúncia', async () => {
  const { moderation } = setup();
  // A primeira denúncia bloqueia; a segunda, no mesmo vídeo, não muda nada.
  const primeira = await denunciar(moderation, { videoId: VIDEO, reason: 'menor' });
  const segunda = await denunciar(moderation, {
    videoId: VIDEO,
    reason: 'sem_consentimento',
  });

  const decisao = await moderation.review({
    id: segunda.id,
    procede: false,
    adminId: 'admin1',
  });
  assert.deepEqual(decisao, { status: 'improcede', blocked: true });
  assert.equal(
    moderation.isBlocked(VIDEO),
    true,
    'o bloqueio é da primeira denúncia, e segue valendo'
  );

  // E a primeira, julgada improcedente, desbloqueia.
  await moderation.review({ id: primeira.id, procede: false, adminId: 'admin1' });
  assert.equal(moderation.isBlocked(VIDEO), false);
});

test('improcede não desfaz bloqueio manual nem remoção na origem', async () => {
  for (const bloqueio of ['admin', 'origem-removeu']) {
    const { moderation, reports } = setup();
    const { id } = await denunciar(moderation, { videoId: VIDEO, reason: 'outro' });
    await reports.block({
      videoId: VIDEO,
      reason: bloqueio,
      blockedAt: AGORA.toISOString(),
    });
    await moderation.refresh();

    await moderation.review({ id, procede: false, adminId: 'admin1' });
    assert.equal(moderation.isBlocked(VIDEO), true, `bloqueio ${bloqueio} sobreviveu`);
  }
});

test('denúncia inexistente dá 404', async () => {
  const { moderation } = setup();
  await assert.rejects(
    () => moderation.review({ id: 'nao-existe', procede: true, adminId: 'a' }),
    { status: 404 }
  );
});

test('bloqueio manual não precisa de denúncia, e valida o id', async () => {
  const { moderation, reports } = setup();
  await moderation.block({ videoId: VIDEO, adminId: 'admin1' });

  assert.equal(moderation.isBlocked(VIDEO), true);
  assert.equal(reports.blocked.get(VIDEO).reason, 'admin');
  assert.equal(reports.reports.length, 0);

  await assert.rejects(() => moderation.block({ videoId: 'id inválido!' }), {
    status: 400,
  });
});

// ---- Sincronismo com a origem ----

test('o que a origem apagou sai do catálogo', async () => {
  const client = { deletedVideos: async (page) => (page === 1 ? ['a1', 'b2'] : ['c3']) };
  const { moderation, reports } = setup({ client });

  const resultado = await moderation.syncWithOrigin({ pages: 2 });

  assert.deepEqual(resultado, { blocked: 3 });
  assert.equal(moderation.isBlocked('a1'), true);
  assert.equal(moderation.isBlocked('c3'), true);
  assert.equal(reports.blocked.get('a1').reason, 'origem-removeu');

  // Rodar de novo não duplica nem reconta o que já estava bloqueado.
  assert.deepEqual(await moderation.syncWithOrigin({ pages: 2 }), { blocked: 0 });
});

test('falha na origem não derruba o sincronismo nem desbloqueia nada', async () => {
  const client = {
    deletedVideos: async (page) => {
      if (page === 1) return ['a1'];
      throw new Error('503 na origem');
    },
  };
  const { moderation } = setup({ client });

  const resultado = await moderation.syncWithOrigin({ pages: 2 });

  assert.deepEqual(resultado, { blocked: 1, failed: true });
  assert.equal(moderation.isBlocked('a1'), true, 'o que deu tempo de bloquear ficou');
});

test('sem cliente, o sincronismo não faz nada e diz isso', async () => {
  const { moderation } = setup();
  assert.deepEqual(await moderation.syncWithOrigin(), { blocked: 0, skipped: true });
});

test('refresh relê a lista do banco, inclusive bloqueio feito por fora', async () => {
  const { moderation, reports } = setup();
  await reports.block({
    videoId: 'de_outra_instancia',
    reason: 'denuncia',
    blockedAt: AGORA.toISOString(),
  });
  assert.equal(moderation.isBlocked('de_outra_instancia'), false, 'ainda não releu');

  assert.equal(await moderation.refresh(), 1);
  assert.equal(moderation.isBlocked('de_outra_instancia'), true);
});
