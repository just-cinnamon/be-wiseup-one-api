import { randomUUID } from 'node:crypto';
import { invalidParams, notFound, tooManyReports } from '../http/errors.js';

/*
 * Regras da denúncia e do bloqueio (ADR-0017).
 *
 * O acervo é de terceiros e ninguém revisa cada vídeo antes de ele aparecer na
 * Home. A denúncia não é um recurso extra: é o único mecanismo que tira do ar
 * conteúdo que não pode ficar.
 */

/** Motivos aceitos. Lista fechada: campo livre de motivo não dá para tratar. */
export const REASONS = [
  'menor',
  'sem_consentimento',
  'violencia',
  'direitos_autorais',
  'outro',
];

/**
 * Os dois motivos que **tiram o vídeo do ar na hora**, antes de qualquer
 * análise humana. Entre deixar no ar por engano e tirar por engano, tira-se: o
 * custo de um falso positivo é um vídeo a menos no catálogo, e o de um falso
 * negativo é crime no ar.
 */
export const IMMEDIATE_BLOCK = ['menor', 'sem_consentimento'];

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
const NOTE_MAX = 500;

// 10 por hora por conta. Não é proteção contra abuso coordenado — é o que
// impede uma conta de limpar o catálogo sozinha num laço.
const MAX_PER_HOUR = 10;

export function createModerationService({
  reports,
  client = null,
  now = () => new Date(),
}) {
  /*
   * Lista de bloqueados em memória, consultada em toda requisição de catálogo.
   * É pequena (ids de vídeo) e evita uma consulta por requisição.
   *
   * Em uma instância só, `block` atualiza o conjunto na hora. Com mais de uma
   * instância, cada processo tem a sua cópia e a de fora fica até um ciclo
   * desatualizada — por isso `refresh()` roda também no sincronismo. Está
   * registrado na ADR como limite conhecido.
   */
  let blockedIds = new Set();

  async function refresh() {
    blockedIds = new Set(await reports.listBlockedIds());
    return blockedIds.size;
  }

  function parse(body = {}) {
    const videoId = String(body.videoId ?? '').trim();
    const reason = String(body.reason ?? '').trim();
    const note = body.note === undefined || body.note === null ? '' : String(body.note);

    if (!VIDEO_ID_PATTERN.test(videoId)) throw invalidParams('Vídeo inválido.');
    if (!REASONS.includes(reason))
      throw invalidParams(`reason deve ser: ${REASONS.join(', ')}.`);
    if (note.length > NOTE_MAX)
      throw invalidParams(`A observação pode ter no máximo ${NOTE_MAX} caracteres.`);

    return { videoId, reason, note: note.trim() || null };
  }

  return {
    /** O vídeo está fora do catálogo? Resposta de memória, sem ir ao banco. */
    isBlocked: (videoId) => blockedIds.has(String(videoId)),

    /** Relê a lista do banco. Chamado no boot e no sincronismo com a origem. */
    refresh,

    /**
     * Registra a denúncia. Motivo de bloqueio imediato tira o vídeo do ar na
     * mesma transação — e só depois o conjunto em memória é atualizado.
     */
    async report({ userId, body }) {
      const { videoId, reason, note } = parse(body);

      const agora = now();
      const umaHoraAtras = new Date(agora.getTime() - 3_600_000).toISOString();
      if ((await reports.countByUserSince(userId, umaHoraAtras)) >= MAX_PER_HOUR) {
        throw tooManyReports();
      }

      const { id, blocked } = await reports.createMaybeBlocking({
        id: randomUUID(),
        videoId,
        userId,
        reason,
        note,
        createdAt: agora.toISOString(),
        blockNow: IMMEDIATE_BLOCK.includes(reason),
      });

      if (blocked) blockedIds.add(videoId);

      // `blocked` volta para o front poder tirar o card da tela na hora. Nos
      // outros motivos a resposta é honesta: foi registrada, e alguém vai ver.
      return { id, blocked };
    },

    /** Fila de análise. */
    listOpen: (options) => reports.listOpen(options),
    listBlocked: (options) => reports.listBlocked(options),

    /**
     * Decisão do administrador.
     *
     * `procede` bloqueia (se ainda não estiver). `improcede` só devolve o vídeo
     * ao ar se o bloqueio tiver vindo **desta** denúncia: bloqueio de outra
     * denúncia, de decisão manual ou de remoção na origem não é desfeito aqui.
     */
    async review({ id, procede, adminId }) {
      const report = await reports.findById(id);
      if (!report) throw notFound();
      if (report.status !== 'aberta')
        throw invalidParams('Esta denúncia já foi analisada.');

      const agora = now().toISOString();
      await reports.review({
        id,
        status: procede ? 'procede' : 'improcede',
        reviewedAt: agora,
        reviewedBy: adminId,
      });

      if (procede) {
        await reports.block({
          videoId: report.video_id,
          reason: 'denuncia',
          blockedAt: agora,
          reportId: id,
        });
        blockedIds.add(report.video_id);
        return { status: 'procede', blocked: true };
      }

      const desbloqueou = await reports.unblockFromReport({
        videoId: report.video_id,
        reportId: id,
      });
      if (desbloqueou) blockedIds.delete(report.video_id);
      // `blocked` é o estado do vídeo **agora**, não o resultado do
      // desbloqueio: denúncia de motivo que não bloqueia nada, julgada
      // improcedente, não pode responder que o vídeo está fora do ar.
      return { status: 'improcede', blocked: blockedIds.has(report.video_id) };
    },

    /** Bloqueio manual, sem denúncia (ADR-0017). */
    async block({ videoId, adminId }) {
      if (!VIDEO_ID_PATTERN.test(String(videoId))) throw invalidParams('Vídeo inválido.');
      await reports.block({
        videoId,
        reason: 'admin',
        blockedAt: now().toISOString(),
        reportId: adminId ? `admin:${adminId}` : null,
      });
      blockedIds.add(String(videoId));
      return { videoId, blocked: true };
    },

    /**
     * Sincronismo com a origem: o que a plataforma apagou sai daqui também.
     * Vídeo removido lá costuma ter sido removido **por algum motivo**, e nosso
     * catálogo não deveria ser o último lugar onde ele segue listado.
     *
     * Falha de rede não é erro fatal: o catálogo continua com a lista que tem.
     */
    async syncWithOrigin({ pages = 1 } = {}) {
      if (!client?.deletedVideos) return { blocked: 0, skipped: true };

      let bloqueados = 0;
      try {
        for (let page = 1; page <= pages; page += 1) {
          const ids = await client.deletedVideos(page);
          for (const videoId of ids) {
            if (blockedIds.has(videoId)) continue;
            await reports.block({
              videoId,
              reason: 'origem-removeu',
              blockedAt: now().toISOString(),
            });
            blockedIds.add(videoId);
            bloqueados += 1;
          }
        }
      } catch (error) {
        console.error('Sincronismo com a origem falhou:', error.message);
        return { blocked: bloqueados, failed: true };
      }
      return { blocked: bloqueados };
    },
  };
}
