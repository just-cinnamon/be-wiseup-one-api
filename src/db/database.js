import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Conexão com o Postgres e aplicação do esquema (ADR-0013).
 *
 * Único lugar que conhece o `pg`. O que sai daqui é um objeto com `query` e
 * `close`, e é só isso que o `usersService` conhece — trocar de banco de novo
 * não deve passar da camada de dados (ADR-0005).
 *
 * O `node:sqlite` saiu porque o disco do Render é efêmero: denúncia, bloqueio
 * de vídeo e aceite de termos precisam sobreviver a um deploy.
 */
export function createDatabase({ connectionString, sslInsecure = false, max = 5 }) {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL não está definida: sem banco não há login, denúncia nem aceite de termos.'
    );
  }

  // Provedor gerenciado (Neon, Supabase, Render) sempre exige TLS; Postgres
  // local, não. `sslInsecure` existe para o provedor que serve certificado
  // próprio, e vem desligado de propósito: relaxar TLS é escolha explícita.
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: !sslInsecure },
    // O plano gratuito costuma limitar conexões, e uma instância só não
    // precisa de mais que isso.
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Erro em conexão parada (o provedor derruba quem fica ocioso) chega como
  // evento, não como rejeição de query: sem este ouvinte, derruba o processo.
  pool.on('error', (error) => {
    console.error('Erro em conexão ociosa do Postgres:', error.message);
  });

  return {
    /** @param {string} text @param {unknown[]} [params] */
    query: (text, params) => pool.query(text, params),

    /** Cria as tabelas, se faltarem. Idempotente: roda em todo boot. */
    applySchema: () => pool.query(schema),

    close: () => pool.end(),
  };
}
