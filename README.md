# be-wiseup-one-api

Back-end do [be-wiseup-one](https://github.com/just-cinnamon/be-wiseup-one). Busca vídeos na Webmasters API do Pornhub e entrega ao front no mesmo formato dos dados fictícios (`Title`).

**Não armazena vídeos nem histórico de uso.** Os vídeos são exibidos pelo embed oficial; o back-end só repassa e converte metadados, com um cache em memória de 10 minutos.

A única exceção são **contas e sessões**, que ficam em SQLite para o login existir de verdade — só e-mail, hash `scrypt` da senha e o sha256 do token de sessão ([ADR-0011](docs/adr/0011-contas-em-sqlite-limitando-a-0004.md), que limita a [ADR-0004](docs/adr/0004-nao-armazenar-nada-cache-em-memoria.md)).

## Stack

Node.js 22 · Express 5 · cors · `node:sqlite` (contas) · `node:crypto` (`scrypt`) · testes com `node:test` · ESLint + Prettier

As duas únicas dependências de produção continuam sendo `express` e `cors` ([ADR-0003](docs/adr/0003-node-22-express-5-minimo-de-dependencias.md)): banco, hash de senha e sessão usam só o que vem no Node.

## Como rodar

```powershell
git clone https://github.com/just-cinnamon/be-wiseup-one-api.git
cd be-wiseup-one-api
npm install
Copy-Item .env.example .env
npm run dev
```

Teste: `curl.exe http://localhost:3333/api/health` → `{"status":"ok"}`

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe o servidor e reinicia ao salvar (lê o `.env`) |
| `npm start` | Sobe o servidor (produção) |
| `npm test` | Roda os testes |
| `npm run lint` | Verifica o código |
| `npm run format` | Formata o código |

## Variáveis de ambiente

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PORT` | `3333` | Porta do servidor (o provedor define em produção) |
| `CORS_ORIGINS` | `http://localhost:5173` | Origens do front liberadas, separadas por vírgula |
| `UPSTREAM_BASE_URL` | `https://www.pornhub.com/webmasters` | API externa |
| `UPSTREAM_TIMEOUT_MS` | `8000` | Tempo máximo de espera da API externa |
| `CACHE_TTL_SECONDS` | `600` | Validade do cache em memória |
| `DATABASE_FILE` | `data/wiseup.db` | Arquivo do SQLite com contas e sessões |
| `RECAPTCHA_SECRET` | _(vazio)_ | Secret do reCAPTCHA v2. Vazio: passa em desenvolvimento com aviso, **recusa todo login em produção** |
| `SESSION_TTL_HOURS` | `12` | Validade da sessão |
| `LOGIN_MAX_ATTEMPTS` | `5` | Erros de senha até bloquear a conta |
| `LOGIN_LOCK_MINUTES` | `15` | Duração do bloqueio |
| `SEED_USERS` | _(vazio)_ | Contas criadas no boot: `email:senha,email:senha` |

## Endpoints

| Rota | Retorna |
| --- | --- |
| `GET /api/health` | `{ "status": "ok" }` |
| `GET /api/home` | `{ featured, top10, rows: [{ id, title, items }] }` |
| `GET /api/videos?q=&category=&ordering=&period=&page=` | `{ page, items, hasMore }` |
| `GET /api/videos/:id` | `Title` + `tags`, `views`, `publishedAt`, `embedUrl` |
| `GET /api/categories` | `[{ id, slug, name }]` |

Valores aceitos: `ordering` = `featured`, `newest`, `mostviewed`, `rating` · `period` = `weekly`, `monthly`, `alltime` · `page` = 1 a 50 · `q` até 80 caracteres.

### Autenticação

Login real, com senha conferida no servidor ([ADR-0011](docs/adr/0011-contas-em-sqlite-limitando-a-0004.md)). Estas são as únicas rotas que não são `GET`, as únicas com corpo JSON (limite de 4kb) e todas respondem com `Cache-Control: no-store`.

| Rota | Corpo / cabeçalho | Retorna |
| --- | --- | --- |
| `POST /api/auth/login` | `{ email, password, captchaToken }` | `{ user: { id, email }, token, expiresAt }` |
| `GET /api/auth/me` | `Authorization: Bearer <token>` | `{ user: { id, email } }` |
| `POST /api/auth/logout` | `Authorization: Bearer <token>` | `{ ok: true }` — apaga a sessão no banco |
| `DELETE /api/auth/me` | `Authorization: Bearer <token>` | `{ ok: true }` — apaga a conta e todas as sessões |

A ordem da verificação do login é fixa: formato dos campos → captcha → bloqueio → senha. O captcha vem **antes** da senha para que força bruta não chegue de graça ao `scrypt`.

- **"E-mail ou senha incorretos."** é a resposta tanto para senha errada quanto para e-mail inexistente, e o segundo caso gasta o tempo de um `scrypt` falso: nem a mensagem nem o relógio revelam quem tem conta.
- No **5º erro de senha** a conta trava por 15 minutos — até para a senha certa. Login bem-sucedido zera o contador.
- O log do servidor registra `POST /api/auth/login 401 212ms` e nada mais: **nunca** e-mail, senha ou token.
- Não há cadastro nem "esqueci a senha": as contas vêm de `SEED_USERS` no boot.

Exemplo:

```powershell
curl.exe -X POST http://localhost:3333/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"ana@wiseup.test","password":"segredo123","captchaToken":"token-de-dev"}'
```

### Erros

Sempre `{ "error": { "code": "...", "message": "..." } }`.

| Status | `code` | Quando |
| --- | --- | --- |
| 400 | `INVALID_PARAMS` | Parâmetro fora da lista permitida, ou corpo que não é JSON válido |
| 400 | `CAPTCHA_FAILED` | O Google não confirmou o token do reCAPTCHA |
| 401 | `INVALID_CREDENTIALS` | Senha errada **ou** e-mail inexistente |
| 401 | `UNAUTHORIZED` | Token de sessão ausente, inválido, expirado ou já desconectado |
| 404 | `NOT_FOUND` | Vídeo inexistente, ou `id` fora do padrão |
| 404 | `ROUTE_NOT_FOUND` | Rota que não existe, ou método não previsto |
| 413 | `PAYLOAD_TOO_LARGE` | Corpo acima de 4kb em `/api/auth` |
| 429 | `TOO_MANY_ATTEMPTS` | Conta bloqueada por erros de senha |
| 502 | `UPSTREAM_UNAVAILABLE` | API externa respondeu erro ou caiu |
| 504 | `UPSTREAM_TIMEOUT` | API externa passou de `UPSTREAM_TIMEOUT_MS` |
| 500 | `INTERNAL_ERROR` | Qualquer outra coisa |

## Limitações conhecidas

| Limitação | Detalhe |
| --- | --- |
| Miniaturas em 320x180 | A API ignora `thumbsize=large_hd` e só devolve 320x180; reescrever a URL quebra a assinatura (HTTP 471). O banner da Home fica borrado — não é bug do front. Ver [ADR-0009](docs/adr/0009-miniaturas-320x180.md) |
| `poster` igual ao `backdrop` | A API não tem imagem vertical, então o Top 10 recebe uma imagem 16:9 |
| URLs de imagem expiram em ~24h | São assinadas pela CDN. O cache de 10 min não é afetado, mas `Title` guardado no `localStorage` do front mostra imagem quebrada depois de um dia |
| `hasMore` é estimativa | A API não informa o total; vale `items.length > 0 && page < 50` e pode prometer página seguinte vazia |
| Cache morre no reinício | É em memória, de propósito. No plano gratuito do Render o serviço dorme em ~15 min. Ver [ADR-0004](docs/adr/0004-nao-armazenar-nada-cache-em-memoria.md) |
| `type` e `maturity` são fixos | `'movie'` e `'18'`: a API não distingue tipo, e todo o acervo é adulto. Ver [ADR-0006](docs/adr/0006-converter-para-o-contrato-title.md) |
| Fixtures envelhecem em silêncio | `test/fixtures/` guarda respostas reais de 05/11/2026; nada avisa quando a API mudar. Ver [ADR-0008](docs/adr/0008-fixtures-com-respostas-reais.md) |
| A API é bloqueada por região | O Pornhub bloqueia vários estados dos EUA pelo IP do servidor. `/api/health` funcionando com `/api/categories` em 502 = região errada |
| Conta criada em produção se perde | O disco do Render é efêmero: o `.db` morre a cada deploy ou hibernação, e só as contas de `SEED_USERS` voltam. Ver [ADR-0011](docs/adr/0011-contas-em-sqlite-limitando-a-0004.md) |
| `node:sqlite` é experimental no Node 22 | Os scripts usam `--experimental-sqlite`. No Node 24+ a flag é dispensável, e segue aceita no 26 |
| Sem cadastro e sem "esqueci a senha" | Fora do escopo: criar conta exigiria moderação, e recuperar senha exigiria enviar e-mail |
| Login sem `RECAPTCHA_SECRET` | Em desenvolvimento o captcha passa sem ser conferido, com aviso no console. Em produção, a falta da variável **recusa todo login** |

## Deploy

Render, Web Service no plano gratuito, **região fora dos EUA** (Frankfurt). Ver
[ADR-0010](docs/adr/0010-deploy-no-render-fora-dos-eua.md) para o porquê.

| Campo | Valor |
| --- | --- |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Auto-Deploy | On Commit (`main`) |

Variáveis a cadastrar: `NODE_VERSION=22` (obrigatória), `CORS_ORIGINS` com a
URL do front publicado, `RECAPTCHA_SECRET` (sem ela **todo login é recusado** em
produção) e `SEED_USERS` com as contas de demonstração. **Não** cadastre `PORT`:
o Render define sozinho.

O disco do plano gratuito é efêmero, então `DATABASE_FILE` pode ficar no padrão
(`data/wiseup.db`): o arquivo morre a cada deploy e as contas de `SEED_USERS`
são recriadas no boot. Conta criada em produção **se perde** — é custo aceito na
[ADR-0011](docs/adr/0011-contas-em-sqlite-limitando-a-0004.md).

### Sobre a versão do Node no Render

O Render resolve a versão nesta ordem de precedência:

1. variável de ambiente `NODE_VERSION`
2. arquivo `.node-version` ← **é o que este repositório usa** (`22`)
3. arquivo `.nvmrc`
4. `engines` do `package.json`

Como o `.node-version` está versionado, **`NODE_VERSION` é dispensável**. Se você
cadastrar a variável, ela sobrepõe o arquivo — e um valor errado quebra o deploy
sem aviso: no primeiro deploy deste projeto, `NODE_VERSION=12` fez o Render usar
Node 12.22.12 e o build falhou. Na dúvida, não cadastre a variável.

Se o build falhar por versão, a mensagem é explícita, por conta do
`engine-strict=true` do `.npmrc`:

```
npm ERR! notsup Unsupported engine for be-wiseup-one-api@0.1.0:
          wanted: {"node":">=22.9"} (current: {"node":"12.22.12","npm":"6.14.16"})
```

E se um Node antigo chegar ao `npm start`, `src/config/checkNode.js` imprime a
versão encontrada e o que fazer.

Depois do deploy, teste as duas:

```powershell
curl.exe https://be-wiseup-one-api.onrender.com/api/health
curl.exe https://be-wiseup-one-api.onrender.com/api/categories
```

## Decisões de arquitetura

As escolhas técnicas deste repositório estão registradas em
[`docs/adr/`](docs/adr/README.md) — por que não existe banco, por que a conversão
para `Title` mora aqui, por que o cache devolve dado vencido quando a API falha.

## Estrutura

```
src/
├── config/
│   ├── env.js              # variáveis de ambiente
│   └── homeSections.js     # fileiras da Home (edite aqui)
├── db/
│   ├── database.js         # abre o SQLite (única parte que usa node:sqlite)
│   └── schema.sql          # tabelas users e sessions
├── http/
│   ├── errors.js           # erros com status e código
│   ├── errorHandler.js     # 404 de rota e formato único de erro
│   └── requireAuth.js      # Authorization: Bearer → req.user
├── mappers/
│   └── videoMapper.js      # API externa → Title
├── routes/
│   ├── index.js            # rotas /api
│   └── auth.js             # rotas /api/auth
├── services/
│   ├── cache.js            # cache em memória (TTL)
│   ├── pornhubClient.js    # única parte que chama a API externa
│   ├── videosService.js    # regras de cada endpoint
│   ├── password.js         # scrypt + timingSafeEqual
│   ├── captchaService.js   # confere o reCAPTCHA no Google
│   ├── usersService.js     # único lugar com SQL
│   └── authService.js      # login, bloqueio e sessão
├── app.js                  # monta o Express (usado nos testes)
└── server.js               # sobe o servidor
test/
├── fixtures/               # respostas reais da API externa
└── *.test.js
docs/
└── adr/                    # decisões de arquitetura
```

## Diário de progresso

### 05/11/2026 — Estrutura inicial
- Endpoints `health`, `home`, `videos`, `videos/:id`, `categories`.
- Cliente da API com timeout, cache e reaproveitamento de resposta expirada quando a API falha.
- Conversão para o contrato `Title` do front.
- Testes de conversão, cliente, cache e regras dos endpoints.

### 05/11/2026 — Dados reais, correções e ADRs
- **Fixtures trocadas por respostas reais** da API (`search`, `video_by_id`, `categories`).
  A comparação revelou que a documentação pública está desatualizada: `video_id` é
  hash (`6ae9db5a2d16a`) e não `ph...`, e `rating` vem número, não texto.
- **Correção em `formatCategory`**: só o sufixo `-1` (desempate de slug) é removido.
  Antes, `18-25` virava `"18"` e `college-18` / `college-18-1` davam nomes diferentes.
- **Correção em `parseDate`**: a data da API é lida como UTC, e `year` usa
  `getUTCFullYear()`. Antes, `publishedAt` mudava de dia conforme o fuso do servidor
  (micro em UTC−3, Render em Frankfurt UTC+1).
- **Fileiras por categoria com `period: 'alltime'`**: com `monthly`, `brazilian`
  devolvia 4 vídeos e `romantic` 14 — carrossel com 4 itens parece quebrado.
  Agora as seis fileiras vêm com 30.
- **Descoberto**: a API ignora `thumbsize=large_hd` e só devolve miniaturas 320x180.
  Reescrever a URL para pedir mais responde HTTP 471 (assinatura inválida). Sem
  solução pelo back-end — ver "Limitações conhecidas".
- Testes: 16 → **19**, todos passando. Lint limpo. Todos os `curl.exe` de
  verificação respondendo (incluindo 400, 404, `ROUTE_NOT_FOUND` e CORS).
- **ADRs 0001 a 0010** criadas em `docs/adr/`, registrando as decisões que o guia
  de criação tomou sem explicar o porquê.

### 05/11/2026 — No ar no Render
Publicado em <https://be-wiseup-one-api.onrender.com/api>.

- O primeiro deploy falhou: `NODE_VERSION` estava com `12` (não `22`), o Render
  usou Node 12.22.12 e o Express 5 não carrega. Corrigido no dashboard.
- Para o erro não voltar a ser cru, entraram `.npmrc` com `engine-strict=true`
  (o `npm install` falha com "Unsupported engine"), `src/config/checkNode.js`
  (primeiro import do `server.js`, imprime a versão encontrada) e
  `.node-version` com `22`, que tem precedência acima do `.nvmrc` — assim o
  deploy não depende mais de variável cadastrada à mão.
- Verificado em produção: `/api/health`, `/api/categories` (243 itens),
  `/api/home` (destaque + Top 10 + 6 fileiras com 30 itens cada), busca,
  `400 INVALID_PARAMS`, `404 ROUTE_NOT_FOUND` e CORS.
- `/api/home` respondeu em **2,1s** na primeira chamada e **0,27s** na segunda:
  o cache em memória está funcionando em produção.
- **Sem bloqueio por região**: `/api/categories` respondeu normalmente, o que era
  o maior risco do deploy (ver [ADR-0010](docs/adr/0010-deploy-no-render-fora-dos-eua.md)).

### 05/11/2026 — Autenticação real (Etapas 1 a 4 do plano)
Login deixou de ser teatro: a senha passa a ser conferida aqui, no servidor.
São as Etapas 1 a 4 do plano de autenticação (as Etapas 5 a 7 são no front e no
deploy).

- **Etapa 1 — ADR primeiro.** [ADR-0011](docs/adr/0011-contas-em-sqlite-limitando-a-0004.md)
  decide guardar contas em SQLite (`node:sqlite`, zero dependência nova) e
  **limita a ADR-0004**, que passa a `substituída parcialmente`: ela continua
  valendo para catálogo, mídia e histórico; deixa de valer para credenciais. A
  ADR-0007 também perdeu a frase "só `GET` existe". Entraram
  `src/db/schema.sql` (`users` e `sessions`), `src/db/database.js` (WAL,
  `foreign_keys = ON`, esquema no boot) e seis variáveis de ambiente novas.
- **Etapa 2 — senha.** `src/services/password.js` com `scrypt` (N=16384, sal de
  32 bytes por usuário) e comparação por `timingSafeEqual`. Os parâmetros vão
  gravados no próprio hash, então aumentar o custo depois não invalida senha
  antiga. Hash corrompido devolve `false` em vez de lançar.
- **Etapa 3 — captcha.** `src/services/captchaService.js` confere o token no
  `siteverify` do Google. Sem `RECAPTCHA_SECRET`: recusa em produção, passa em
  desenvolvimento com aviso — nunca o contrário. Google fora do ar vira captcha
  recusado.
- **Etapa 4 — login, sessão e rotas.** `usersService.js` (único lugar com SQL) e
  `authService.js` (regras fora do Express), mais `requireAuth.js` e as quatro
  rotas de `/api/auth`. O token da sessão é opaco e **só o sha256 vai para o
  banco**. O `cors` passou a aceitar `POST` e `DELETE`, e `express.json` é
  montado só em `/api/auth`.
- Dois desvios conscientes do plano, com o motivo: o limite do corpo ficou em
  **4kb** em vez de 1kb (um token do reCAPTCHA v2 sozinho passa de 1kb, e o
  login responderia 413), e o **5º erro de senha responde 429**, não 401, porque
  nessa tentativa a conta já está travada.
- O log passou a usar `req.originalUrl`: ao montar em `/api` o Express reescreve
  `req.url`, e as linhas saíam como `POST /login`. Agora saem como o plano pede:
  `POST /api/auth/login 401 212ms`. Conferido que **nenhum e-mail, senha ou
  token** aparece no log.
- 43 testes (eram 23), `npm run lint` limpo. Os novos usam banco em memória
  (`DatabaseSync(':memory:')`), captcha falso e relógio controlado, para testar
  bloqueio e expiração sem esperar.
- Verificado com `curl.exe`: login certo, senha errada, e-mail inexistente (mesma
  mensagem e tempo parecido), sem captcha, JSON malformado (400), corpo de 5kb
  (413), `me` sem token, `me` com token, logout, `me` depois do logout, 6
  tentativas seguidas (401×4 → 429×2), senha certa com a conta travada (429),
  `DELETE /auth/me` e o `no-store` em todas elas. Os endpoints de vídeo e o
  _preflight_ de CORS continuam de pé.

### Próximos passos
- `CORS_ORIGINS` com a URL do front quando ele for publicado (hoje só
  `http://localhost:5173`).
- **Etapa 0 do plano (manual):** registrar o site em
  <https://www.google.com/recaptcha/admin> (reCAPTCHA v2) e cadastrar o
  `RECAPTCHA_SECRET` aqui e a site key no front. Até lá o captcha não é
  conferido de verdade.
- **Etapa 5 (front):** `VITE_AUTH_MODE=api`, `Authorization` no `api.js`,
  `AuthProvider` revalidando com `GET /api/auth/me` e o botão "Excluir minha
  conta".
- **Etapa 7 (deploy):** cadastrar `RECAPTCHA_SECRET`, `DATABASE_FILE` e
  `SEED_USERS` no Render. Lembrar que o disco é efêmero: conta criada em
  produção se perde.
