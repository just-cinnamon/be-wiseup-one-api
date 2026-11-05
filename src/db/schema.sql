-- Esquema do banco (ADR-0011). Executado no boot, sempre com IF NOT EXISTS:
-- não há migration, então o arquivo precisa ser idempotente.
--
-- Só contas e sessões moram aqui. Catálogo, miniatura e histórico de uso
-- continuam fora do banco, como manda a ADR-0004.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,         -- crypto.randomUUID()
  email         TEXT NOT NULL UNIQUE,     -- sempre em minúsculas
  password_hash TEXT NOT NULL,            -- scrypt$N$r$p$sal$hash (base64)
  created_at    TEXT NOT NULL,            -- ISO 8601
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT                      -- ISO 8601, ou NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,            -- sha256 do token; o original só o front tem
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
