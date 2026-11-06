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

-- Declaração de maioridade (ADR-0019, que substituiu em parte a ADR-0015).
--
-- A pessoa **declara** ser maior de 18 anos, e é isso que fica registrado:
-- quando declarou, por qual meio e de qual IP. Não existe documento, foto,
-- CPF nem data de nascimento em lugar nenhum deste banco — e não é por
-- enquanto: é a decisão.
--
-- `age_method` guarda 'autodeclaracao'. A coluna existe para que um dia poder
-- conviver com outro meio (verificação por terceiro, por exemplo) sem perder a
-- informação de como cada conta foi liberada.
--
-- ADD COLUMN IF NOT EXISTS mantém o arquivo idempotente para banco já criado.
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_method      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_declared_ip TEXT;

-- Aceite de termos (ADR-0016). Guarda **o histórico**: uma linha por versão
-- aceita, e nada é apagado quando uma versão nova sai. É esse registro que
-- responde, depois, "o que exatamente esta pessoa aceitou, e quando".
CREATE TABLE IF NOT EXISTS terms_acceptances (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document    TEXT NOT NULL,            -- 'termos' | 'privacidade'
  version     TEXT NOT NULL,            -- data da versão, ex.: '2026-11-05'
  accepted_at TEXT NOT NULL,            -- ISO 8601
  PRIMARY KEY (user_id, document, version)
);

-- Denúncias (ADR-0017). `user_id` com ON DELETE SET NULL de propósito: apagar a
-- conta não pode apagar a denúncia. Se alguém denuncia conteúdo com menor de
-- idade e depois exclui a conta, a denúncia continua valendo — ela é sobre o
-- vídeo, não sobre quem denunciou.
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'aberta',  -- aberta | procede | improcede
  reviewed_at TEXT,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_video  ON reports(video_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
-- Serve o limite de denúncias por hora, que consulta por conta e data.
CREATE INDEX IF NOT EXISTS idx_reports_user   ON reports(user_id, created_at);

-- Vídeos tirados do catálogo. Lista pequena e consultada em toda requisição de
-- catálogo, então fica em memória e é relida daqui (ADR-0017).
CREATE TABLE IF NOT EXISTS blocked_videos (
  video_id   TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,   -- denuncia | admin | origem-removeu
  blocked_at TEXT NOT NULL,
  report_id  TEXT
);

-- Quem pode analisar denúncia. Marcado à mão no banco: não existe rota que
-- promova ninguém a administrador.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Registro de acesso (ADR-0018), exigido pelo Marco Civil da Internet
-- (art. 15): quem entrou e quando. É gravado **só no login**, nunca por
-- requisição, e não guarda o que foi buscado nem o que foi assistido.
--
-- `user_id` é TEXT sem chave estrangeira **de propósito**: o registro tem de
-- sobreviver à exclusão da conta pelos seis meses da lei. Com REFERENCES, ou o
-- CASCADE apagaria o registro, ou o SET NULL o deixaria sem dizer quem acessou
-- — e aí ele não serviria para nada.
CREATE TABLE IF NOT EXISTS access_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  ip          TEXT,
  accessed_at TEXT NOT NULL
);

-- Serve a faxina diária, que apaga por data.
CREATE INDEX IF NOT EXISTS idx_access_logs_date ON access_logs(accessed_at);
