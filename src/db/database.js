import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Abre o banco de contas e aplica o esquema (ADR-0011).
 *
 * Único lugar que conhece `node:sqlite`. Passe ':memory:' nos testes.
 * No Node 22 isto exige a flag --experimental-sqlite, já nos scripts do
 * package.json; no Node 24+ ela é dispensável.
 */
export function openDatabase(file) {
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);

  // WAL deixa leitura e escrita conviverem sem travar uma na outra. Em banco de
  // memória o SQLite ignora o pedido, e isso não é erro.
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
  // Sem isto o ON DELETE CASCADE de sessions não roda: o SQLite nasce com as
  // chaves estrangeiras desligadas, por compatibilidade.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);

  return db;
}
