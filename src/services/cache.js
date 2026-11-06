/**
 * Cache em memória com validade (TTL). Some quando o servidor reinicia.
 * Guarda só respostas JSON da API externa, nunca vídeos ou imagens.
 *
 * Cada entrada guarda **quando foi gravada** (`storedAt`), e não só quando
 * vence. É o que permite ao cliente recusar dado velho demais (ADR-0018): a
 * resposta expirada é usada quando a origem falha, mas, passado o teto, ela
 * pode descrever um catálogo onde um vídeo já removido na origem continua
 * listado — e aí é melhor dar erro do que mostrar o que não devia existir.
 */
export function createCache({ ttlSeconds, maxEntries = 500, now = () => Date.now() }) {
  const store = new Map();

  return {
    /** Retorna { value, fresh, ageSeconds } ou undefined. */
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      const agora = now();
      return {
        value: entry.value,
        fresh: entry.expiresAt > agora,
        ageSeconds: Math.max(0, Math.floor((agora - entry.storedAt) / 1000)),
      };
    },
    set(key, value) {
      store.delete(key);
      const agora = now();
      store.set(key, { value, storedAt: agora, expiresAt: agora + ttlSeconds * 1000 });
      // Map mantém a ordem de inserção: o primeiro é o mais antigo.
      if (store.size > maxEntries) store.delete(store.keys().next().value);
    },
    /** Descarta a entrada: o cliente usa quando o dado passou do teto. */
    delete(key) {
      return store.delete(key);
    },
    get size() {
      return store.size;
    },
  };
}
