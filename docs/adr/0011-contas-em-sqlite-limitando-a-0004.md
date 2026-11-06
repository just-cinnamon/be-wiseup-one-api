# ADR-0011 — Guardar contas em SQLite, limitando a ADR-0004

- **Status:** aceita, **parcialmente substituída** — o armazenamento passou a
  Postgres pela [ADR-0013](0013-postgres-gerenciado-no-lugar-do-sqlite.md), e a
  exigência do captcha virou condicional pela
  [ADR-0014](0014-captcha-exigido-so-com-secret.md). O resto continua valendo:
  contas em banco, scrypt, token opaco em tabela e a ordem do login
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 6 — Autenticação real

## Contexto

Até aqui o login do front era teatro: qualquer e-mail com qualquer senha de
quatro caracteres entrava, porque não havia onde conferir credencial
([ADR-0006 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0006-sessao-em-context-com-localstorage.md)).
A tela ainda afirmava, em letras pequenas, estar protegida pelo reCAPTCHA — sem
reCAPTCHA nenhum atrás, porque verificar o desafio exige um `secret` que não
pode morar no navegador.

Validar senha no front é impossível por definição: o que o navegador recebe,
quem usa também recebe. Então ou o back-end guarda conta, ou não existe login.

O problema é que a [ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md) se
chama literalmente **"Não armazenar nada"**, e um dos três motivos que ela dá
para recusar banco é dado pessoal em projeto sem política de privacidade.
Guardar e-mail e senha contraria essa decisão de frente — e a regra do
repositório é não reescrever ADR aceita.

Duas coisas mudaram o contexto desde a ADR-0004:

- a **política de cookies e o consentimento por categoria** foram publicados no
  front (Etapa 6 do plano de autenticação), o que dá a base que faltava para
  tratar dado pessoal;
- existe um caminho para **exercer o direito de exclusão**
  (`DELETE /api/auth/me`), que era justamente o que não havia como oferecer.

A [ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md) continua
valendo: só `express` e `cors` como dependências de produção.

## Decisão

**Contas e sessões passam a ser persistidas**, em SQLite embutido
(`node:sqlite`), e a ADR-0004 fica **limitada**: continua valendo integralmente
para catálogo, mídia e histórico de uso; deixa de valer para credenciais.

O que entra no banco, e só isso:

| Tabela | Colunas | Observação |
| --- | --- | --- |
| `users` | `id`, `email`, `password_hash`, `created_at`, `failed_count`, `locked_until` | `email` sempre em minúsculas e `UNIQUE` |
| `sessions` | `token_hash`, `user_id`, `created_at`, `expires_at` | guarda o **sha256** do token, nunca o token |

O que **continua fora** do banco: metadados de vídeo, miniatura, histórico de
quem assistiu ou buscou, IP e perfis (que seguem no `localStorage` do front).

Escolhas técnicas, cada uma presa à ADR-0003:

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Banco | `node:sqlite` (`DatabaseSync`) | Zero dependência nova; `--experimental-sqlite` no Node 22, nativo no Node 24+ |
| Hash de senha | `crypto.scrypt`, não `bcrypt` | Nativo, e recomendação atual da OWASP. Formato `scrypt$N$r$p$sal$hash` |
| Comparação | `timingSafeEqual` | O tempo de resposta não revela quantos bytes do hash foram acertados |
| Token de sessão | Opaco, em tabela — não JWT | Sem biblioteca, e **dá para revogar** no logout; JWT não dá |
| Bloqueio por tentativas | `failed_count` / `locked_until` na linha do usuário | Sem tabela de tentativas e sem contador em memória, que o Render zera ao hibernar |
| Contas de demonstração | `SEED_USERS`, semeadas no boot | O disco do Render é efêmero: sem isso o login morre a cada deploy |

Duas partes de ADRs anteriores caem com esta decisão:

1. **ADR-0004** passa a `substituída parcialmente`, como descrito acima.
2. **ADR-0007** afirmava que **"só `GET` existe"**. Essa frase caiu: o `cors`
   agora aceita `['GET', 'POST', 'DELETE']` com
   `allowedHeaders: ['Content-Type', 'Authorization']`, e
   `express.json({ limit: '1kb' })` é montado **só** em `/api/auth`. Todo o
   resto da ADR-0007 continua valendo — e ganha quatro códigos de erro novos:
   `CAPTCHA_FAILED` (400), `INVALID_CREDENTIALS` (401), `UNAUTHORIZED` (401) e
   `TOO_MANY_ATTEMPTS` (429).

A ordem do login não é negociável (`src/services/authService.js`):

```
POST /api/auth/login   { email, password, captchaToken }
   |- 1. formato dos campos (allowlist, ADR-0007)   -> 400 INVALID_PARAMS
   |- 2. captcha no siteverify do Google            -> 400 CAPTCHA_FAILED
   |- 3. conta bloqueada?                           -> 429 TOO_MANY_ATTEMPTS
   |- 4. usuário existe e a senha confere?          -> 401 INVALID_CREDENTIALS
   \- 5. cria sessão                                -> 200 { user, token, expiresAt }
```

- **O captcha vem antes da senha**: ele existe para que força bruta custe caro,
  e conferir depois deixaria a parte caríssima (`scrypt`) exposta a quem nem
  resolveu o desafio.
- **"E-mail ou senha incorretos."** é a mensagem dos dois casos. Dizer "este
  e-mail não existe" transformaria o login num verificador de quem tem conta no
  site; pelo mesmo motivo, e-mail inexistente **gasta o tempo de um `scrypt`
  falso**, para o relógio não contar o que a mensagem esconde.
- **O log continua sem e-mail**, mantendo a regra que a ADR-0004 já impunha
  para termos de busca: `POST /api/auth/login 401 212ms` e nada mais.
- **`Cache-Control: no-store`** em toda rota de `/api/auth`, contra o
  `max-age=300` das outras.

## Consequências

**Positivas**

- Senha errada não entra mais. O login deixa de ser decorativo, e a frase sobre
  o reCAPTCHA na tela de login passa a ser verdade.
- O `secret` do reCAPTCHA tem onde morar, então o widget do front deixa de ser
  enfeite.
- Logout **revoga** de fato: a linha sai de `sessions` e o token morre na hora.
- `DELETE /api/auth/me` apaga conta e sessões (`ON DELETE CASCADE`), o que torna
  o direito de exclusão da LGPD exercível — e era condição para esta ADR
  existir.
- Força bruta fica cara: `scrypt` por tentativa, captcha antes da senha e
  bloqueio de 15 minutos no quinto erro.
- Vazamento do arquivo do banco não entrega sessão ativa de ninguém (só o
  sha256 do token) nem senha em claro (só `scrypt`).
- Nenhuma dependência nova: a ADR-0003 sobrevive intacta.

**Negativas / custos aceitos**

- **O disco do Render é efêmero**: o `.db` morre a cada deploy ou hibernação.
  `SEED_USERS` recria as contas de demonstração no boot, mas **conta criada em
  produção se perde**. Está no plano, não é surpresa.
- `node:sqlite` é **experimental no Node 22** e exige `--experimental-sqlite`
  nos scripts (a flag continua aceita no Node 26, conferido; no Node 24+ é
  dispensável).
- **Dado pessoal onde antes não havia.** Mitigado por ser só e-mail e hash — sem
  IP, sem e-mail em log — e pela exclusão funcionando.
- **Uma instância, um arquivo**: não escala horizontalmente. Irrelevante no
  plano gratuito, que roda uma instância.
- O front guarda o token no `localStorage` (decisão do outro repositório), o que
  é vulnerável a XSS. Mitigação no back: TTL curto de sessão
  (`SESSION_TTL_HOURS`, 12h por padrão) e logout que revoga.
- `DatabaseSync` é **síncrono**: cada consulta bloqueia o laço de eventos. São
  consultas por chave primária em tabelas minúsculas, mas é uma porta aberta
  para problema se o escopo crescer.
- O deploy ganha duas variáveis que importam (`RECAPTCHA_SECRET`, `SEED_USERS`)
  e uma pasta para o arquivo do banco.

## Alternativas consideradas

- **Postgres gerenciado (Neon/Supabase)** — resolveria o disco efêmero e a conta
  que se perde, mas somaria a dependência `pg` contra a ADR-0003 e mais um
  serviço externo para administrar. É a saída natural se o projeto precisar de
  conta que sobreviva a deploy.
- **`better-sqlite3`** — API mais madura e não experimental, porém é dependência
  nativa, com compilação no deploy, contra a ADR-0003.
- **`bcrypt`** — o padrão mais conhecido, mas é dependência nativa, e `scrypt`
  nativo atende à mesma recomendação da OWASP.
- **JWT assinado, sem tabela de sessões** — dispensaria a tabela `sessions`, mas
  não há como revogar um token antes de expirar: o logout viraria enfeite.
- **Cookie `httpOnly` em vez de token no corpo** — protegeria contra XSS, mas
  seria cookie _third-party_ (front na Vercel, API no Render): o Safari bloqueia
  e o Chrome está encerrando esse caminho.
- **Autenticação de terceiros (Google, Auth0)** — nenhuma senha para guardar,
  porém traz dependência externa, configuração de OAuth e dado pessoal fora do
  nosso controle, para um projeto de estudo.
- **Manter o login visual e não guardar nada** — preservaria a ADR-0004 inteira,
  ao custo de o produto não ter login. Foi o que já existia, e é o que esta ADR
  encerra.

## Referências

- Plano de autenticação (repositório do front), Etapas 1 a 4
- [ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md),
  [ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md),
  [ADR-0005](0005-camadas-client-mapper-service.md),
  [ADR-0007](0007-erros-padronizados-e-validacao-por-allowlist.md)
- `src/db/schema.sql`, `src/db/database.js`
- `src/services/password.js`, `src/services/captchaService.js`
- `src/services/usersService.js`, `src/services/authService.js`
- `src/http/requireAuth.js`, `src/routes/auth.js`
- `test/password.test.js`, `test/captchaService.test.js`, `test/authService.test.js`
- `README.md` → "Endpoints" e "Variáveis de ambiente"
