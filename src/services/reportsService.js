/**
 * Camada de dados das denúncias e dos bloqueios (ADR-0017).
 *
 * Só SQL, como o `usersService`: as regras — quais motivos existem, quantas
 * denúncias por hora, o que bloqueia na hora — ficam no `moderationService`.
 * Quem recebe o `db` por parâmetro é testável com um Postgres de verdade e
 * substituível por um duplo em memória (ADR-0005).
 */
export function createReportsService({ db }) {
  return {
    /**
     * Grava a denúncia e, quando o motivo exige, **bloqueia o vídeo na mesma
     * transação**. Denúncia de conteúdo com menor registrada e vídeo ainda no
     * ar porque a segunda consulta falhou é exatamente o que não pode
     * acontecer.
     *
     * @param {{ id: string, videoId: string, userId: string|null, reason: string,
     *   note: string|null, createdAt: string, blockNow: boolean }} report
     * @returns {Promise<{ id: string, blocked: boolean }>}
     */
    async createMaybeBlocking({
      id,
      videoId,
      userId,
      reason,
      note,
      createdAt,
      blockNow,
    }) {
      return db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO reports (id, video_id, user_id, reason, note, created_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'aberta')`,
          [id, videoId, userId, reason, note, createdAt]
        );

        if (!blockNow) return { id, blocked: false };

        // Já bloqueado por outra denúncia: fica como está, com o bloqueio
        // (e o `report_id`) da primeira. O vídeo fora do ar é o que importa.
        await tx.query(
          `INSERT INTO blocked_videos (video_id, reason, blocked_at, report_id)
           VALUES ($1, 'denuncia', $2, $3)
           ON CONFLICT (video_id) DO NOTHING`,
          [videoId, createdAt, id]
        );
        return { id, blocked: true };
      });
    },

    /** Quantas denúncias esta conta fez desde `sinceIso`. Serve o limite horário. */
    async countByUserSince(userId, sinceIso) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM reports
          WHERE user_id = $1 AND created_at >= $2`,
        [userId, sinceIso]
      );
      return rows[0]?.total ?? 0;
    },

    /** Denúncias abertas, das mais antigas para as mais novas (fila de análise). */
    async listOpen({ limit = 100 } = {}) {
      const { rows } = await db.query(
        `SELECT id, video_id, reason, note, created_at, status
           FROM reports
          WHERE status = 'aberta'
          ORDER BY created_at ASC
          LIMIT $1`,
        [limit]
      );
      return rows;
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT id, video_id, user_id, reason, note, created_at, status,
                reviewed_at, reviewed_by
           FROM reports WHERE id = $1`,
        [id]
      );
      return rows[0];
    },

    /** Marca a decisão. Só muda denúncia aberta: analisar duas vezes não vale. */
    async review({ id, status, reviewedAt, reviewedBy }) {
      const { rowCount } = await db.query(
        `UPDATE reports
            SET status = $2, reviewed_at = $3, reviewed_by = $4
          WHERE id = $1 AND status = 'aberta'`,
        [id, status, reviewedAt, reviewedBy]
      );
      return rowCount > 0;
    },

    // ---- Bloqueios ----

    async block({ videoId, reason, blockedAt, reportId = null }) {
      await db.query(
        `INSERT INTO blocked_videos (video_id, reason, blocked_at, report_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (video_id) DO NOTHING`,
        [videoId, reason, blockedAt, reportId]
      );
    },

    /**
     * Desbloqueia **só** o que foi bloqueado por esta denúncia. Se o bloqueio
     * veio de outra denúncia, de decisão de administrador ou da origem ter
     * removido o vídeo, julgar esta improcedente não devolve o vídeo ao ar.
     */
    async unblockFromReport({ videoId, reportId }) {
      const { rowCount } = await db.query(
        `DELETE FROM blocked_videos
          WHERE video_id = $1 AND reason = 'denuncia' AND report_id = $2`,
        [videoId, reportId]
      );
      return rowCount > 0;
    },

    /** Lista completa dos ids bloqueados; é o que alimenta o filtro em memória. */
    async listBlockedIds() {
      const { rows } = await db.query(`SELECT video_id FROM blocked_videos`);
      return rows.map((r) => r.video_id);
    },

    async listBlocked({ limit = 200 } = {}) {
      const { rows } = await db.query(
        `SELECT video_id, reason, blocked_at, report_id
           FROM blocked_videos
          ORDER BY blocked_at DESC
          LIMIT $1`,
        [limit]
      );
      return rows;
    },
  };
}
