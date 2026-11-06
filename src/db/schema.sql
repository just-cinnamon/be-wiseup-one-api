-- Esquema do banco (ADR-0013). Executado no boot, sempre com IF NOT EXISTS:
-- não há ferramenta de migration, então o arquivo precisa ser idempotente.
--
-- Só contas e sessões moram aqui. Catálogo, miniatura e histórico de uso
-- continuam fora do banco, como manda a ADR-0004.
--
-- As colunas de data são TEXT com ISO 8601 em UTC, e não TIMESTAMPTZ, por um
-- motivo prático: o código compara essas datas como string em vários lugares
-- (`expires_at <= nowIso`), e ISO 8601 em UTC ordena igual como texto e como
-- data. Com TIMESTAMPTZ o driver devolveria `Date`, e a comparação mudaria de
-- forma em todo o serviço sem ganho nenhum aqui.

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
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Verificação de idade (ADR-0015). Guardamos **só o resultado**: nunca foto,
-- documento, CPF nem data de nascimento. `age_ref` é o identificador da
-- verificação no provedor, usado para casar o webhook com a conta — e é o que
-- marca uma verificação em andamento enquanto `age_verified_at` é nulo.
-- ADD COLUMN IF NOT EXISTS mantém o arquivo idempotente para banco já criado.
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_method      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_ref         TEXT;

CREATE INDEX IF NOT EXISTS idx_users_age_ref ON users(age_ref);
