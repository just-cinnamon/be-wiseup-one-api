/**
 * Registro de acesso (ADR-0018).
 *
 * O Marco Civil da Internet (art. 15) obriga a guardar registro de acesso por
 * seis meses. Este arquivo é a implementação mínima disso — e a palavra
 * "mínima" é a decisão, não uma limitação: guarda-se **só** quem entrou, de
 * qual IP e quando.
 *
 * O que **não** entra aqui, e não deve passar a entrar:
 * - o que a pessoa buscou;
 * - que vídeo ela abriu ou assistiu;
 * - navegador, sistema ou impressão digital do aparelho.
 *
 * Nada disso é exigido por lei, e tudo isso seria um histórico de consumo
 * pornográfico por pessoa — o tipo de base que, vazando, faz dano irreparável.
 */
export function createAccessLogService({
  db,
  now = () => new Date(),
  retentionDays = 180,
}) {
  return {
    /**
     * Grava uma linha. Chamado **uma vez por login**, e não por requisição:
     * por requisição seria rastro de navegação, que é outra coisa.
     *
     * Nunca lança: falha no registro não pode impedir alguém de entrar na
     * conta. O erro vai para o log do processo, onde dá para perceber.
     */
    async record({ userId, ip }) {
      try {
        await db.query(
          `INSERT INTO access_logs (user_id, ip, accessed_at) VALUES ($1, $2, $3)`,
          [userId, ip ?? null, now().toISOString()]
        );
        return true;
      } catch (error) {
        console.error('Falha ao gravar registro de acesso:', error.message);
        return false;
      }
    },

    /**
     * Apaga o que passou dos seis meses. Rodar isso é parte da obrigação, e
     * não um detalhe de manutenção: guardar além do prazo deixa de ser
     * cumprimento de obrigação legal e passa a ser retenção sem base.
     */
    async purge() {
      const limite = new Date(
        now().getTime() - retentionDays * 24 * 60 * 60 * 1000
      ).toISOString();
      const { rowCount } = await db.query(
        `DELETE FROM access_logs WHERE accessed_at < $1`,
        [limite]
      );
      return rowCount;
    },

    /** Só para conferência em desenvolvimento e nos testes. */
    async countForUser(userId) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM access_logs WHERE user_id = $1`,
        [userId]
      );
      return rows[0]?.total ?? 0;
    },
  };
}
