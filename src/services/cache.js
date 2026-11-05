/**
 * Cache em memória com validade (TTL). Some quando o servidor reinicia.
 * Guarda só respostas JSON da API externa, nunca vídeos ou imagens.
 */
export function createCache({ ttlSeconds, maxEntries = 500, now = () => Date.now() }) {
  const store = new Map();

  return {
    /** Retorna { value, fresh } ou undefined. */
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      return { value: entry.value, fresh: entry.expiresAt > now() };
    },
    set(key, value) {
      store.delete(key);
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      // Map mantém a ordem de inserção: o primeiro é o mais antigo.
      if (store.size > maxEntries) store.delete(store.keys().next().value);
    },
    get size() {
      return store.size;
    },
  };
}
