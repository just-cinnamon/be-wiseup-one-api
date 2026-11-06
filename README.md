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

| Comando                                     | O que faz                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`                               | Sobe o servidor e reinicia ao salvar (lê o `.env`)                               |
| `npm start`                                 | Sobe o servidor (produção)                                                       |
| `npm test`                                  | Roda os testes                                                                   |
| `npm run lint`                              | Verifica o código                                                                |
| `npm run format`                            | Formata o código                                                                 |
| `npm run conferir -- <url> [email] [senha]` | Confere, de fora, se a API publicada é esta versão e se as barreiras estão de pé |

## Variáveis de ambiente

| Variável                | Padrão                               | Para quê                                                                                                                                                                                   |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                  | `3333`                               | Porta do servidor (o provedor define em produção)                                                                                                                                          |
| `CORS_ORIGINS`          | `http://localhost:5173`              | Origens do front liberadas, separadas por vírgula                                                                                                                                          |
| `UPSTREAM_BASE_URL`     | `https://www.pornhub.com/webmasters` | API externa                                                                                                                                                                                |
| `UPSTREAM_TIMEOUT_MS`   | `8000`                               | Tempo máximo de espera da API externa                                                                                                                                                      |
| `CACHE_TTL_SECONDS`     | `600`                                | Validade do cache em memória                                                                                                                                                               |
| `DATABASE_URL`          | —                                    | **Obrigatória.** Postgres com contas, sessões, aceites, denúncias e registros de acesso ([ADR-0013](docs/adr/0013-postgres-gerenciado-no-lugar-do-sqlite.md)). Sem ela o processo não sobe |
| `DATABASE_SSL_INSECURE` | `false`                              | `true` aceita certificado próprio do provedor. Relaxar TLS é escolha explícita                                                                                                             |
| `RECAPTCHA_SECRET`      | _(vazio)_                            | Secret do reCAPTCHA v2. **Vazio: o captcha não é exigido** ([ADR-0014](docs/adr/0014-captcha-exigido-so-com-secret.md)) — exigir um token que ninguém confere seria teatro                 |
| `SESSION_TTL_HOURS`     | `12`                                 | Validade da sessão                                                                                                                                                                         |
| `LOGIN_MAX_ATTEMPTS`    | `5`                                  | Erros de senha até bloquear a conta                                                                                                                                                        |
| `LOGIN_LOCK_MINUTES`    | `15`                                 | Duração do bloqueio                                                                                                                                                                        |
| `SEED_USERS`            | _(vazio)_                            | Contas criadas no boot: `email:senha,email:senha`                                                                                                                                          |

A idade **não tem variável nenhuma**: ela é declarada pela própria pessoa
([ADR-0019](docs/adr/0019-idade-por-autodeclaracao.md)), e não há provedor para
contratar nem segredo para cadastrar.

## Endpoints

| Rota                                                   | Retorna                                                |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `GET /api/health`                                      | `{ "status": "ok" }` — aberta, não devolve dado nenhum |
| `GET /api/home`                                        | `{ featured, top10, rows: [{ id, title, items }] }`    |
| `GET /api/videos?q=&category=&ordering=&period=&page=` | `{ page, items, hasMore }`                             |
| `GET /api/videos/:id`                                  | `Title` + `tags`, `views`, `publishedAt`, `embedUrl`   |
| `GET /api/categories`                                  | `[{ id, slug, name }]`                                 |

Valores aceitos: `ordering` = `featured`, `newest`, `mostviewed`, `rating` · `period` = `weekly`, `monthly`, `alltime` · `page` = 1 a 50 · `q` até 80 caracteres.

### Três barreiras antes do catálogo

Nenhuma miniatura, título ou `embedUrl` sai da API sem as três. **A ordem em
`src/routes/index.js` é a regra de acesso**, e tudo que está registrado depois
de um `router.use` exige aquela barreira:

| Ordem | Barreira                                        | Falta?               | ADR                                                  |
| ----- | ----------------------------------------------- | -------------------- | ---------------------------------------------------- |
| 1     | Sessão válida (`Authorization: Bearer`)         | `401 UNAUTHORIZED`   | [0012](docs/adr/0012-catalogo-exige-sessao.md)       |
| 2     | Maioridade declarada pela pessoa                | `403 AGE_REQUIRED`   | [0019](docs/adr/0019-idade-por-autodeclaracao.md)    |
| 3     | Termos e privacidade aceitos, na versão vigente | `403 TERMS_REQUIRED` | [0016](docs/adr/0016-aceite-de-termos-por-versao.md) |

Campo ausente ou nulo é sempre "não": dado que falta nunca libera acesso.

### Declaração de maioridade e aceite — a porta única

| Rota                    | Corpo / cabeçalho       | Retorna                                                            |
| ----------------------- | ----------------------- | ------------------------------------------------------------------ |
| `POST /api/auth/accept` | `Authorization: Bearer` | `{ ageVerified: true, termsAccepted: true, acceptedAt, versions }` |

Exige sessão e **não** exige idade declarada nem termos aceitos — seria o
cadeado trancando a chave dentro. Não há corpo a validar, porque não há opção a
escolher: é uma caixa de seleção que diz as duas coisas, e ela fica na tela do
front ([ADR-0019](docs/adr/0019-idade-por-autodeclaracao.md)).

As duas são gravadas **na mesma transação**: não existe estado em que a pessoa
aceitou os termos e não declarou a idade, ou o contrário.

O que fica guardado:

- da idade — **quando** declarou, por qual **meio** (`autodeclaracao`) e de qual
  **IP**. Numa declaração, a data e o IP são toda a evidência que existe;
- dos documentos — uma linha por documento e versão, e **nada é apagado** quando
  sai versão nova: é o que responde depois "o que esta conta aceitou, e quando".
  A versão vigente está em `src/config/legal.js` — mudar a data ali obriga todo
  mundo a aceitar de novo, sem deslogar ninguém e sem pedir a declaração outra
  vez.

Chamar de novo não reescreve a declaração nem duplica o aceite: a declaração que
vale é a primeira, porque é a que a pessoa fez.

> **Isto não verifica idade.** Não pedimos documento nem foto, e não existe
> coluna para eles em nenhuma tabela. Quem marca a caixa declarando idade falsa
> entra — é a consequência da decisão, está na ADR-0019 e nas páginas legais do
> front, e a volta para verificação por terceiro está desenhada na
> [ADR-0015](docs/adr/0015-verificacao-de-idade-no-servidor.md).

### Denúncia e moderação

| Rota                           | Quem pode       | Retorna                                                               |
| ------------------------------ | --------------- | --------------------------------------------------------------------- |
| `GET /api/reports/reasons`     | qualquer sessão | `{ reasons }` — a lista que o front mostra                            |
| `POST /api/reports`            | qualquer sessão | `{ id, blocked }` — `blocked: true` = o vídeo **já saiu** do catálogo |
| `GET /api/reports/open`        | `is_admin`      | `{ reports }` — fila de análise                                       |
| `GET /api/reports/blocked`     | `is_admin`      | `{ blocked }` — o que está fora, e por quê                            |
| `POST /api/reports/:id/review` | `is_admin`      | `{ status, blocked }` — corpo `{ procede: true }`                     |
| `POST /api/reports/block`      | `is_admin`      | `{ videoId, blocked }` — bloqueio manual                              |

- `menor` e `sem_consentimento` **tiram o vídeo do ar na hora**, na mesma
  transação da denúncia, antes de qualquer análise. Os outros motivos
  (`violencia`, `direitos_autorais`, `outro`) entram na fila.
- Vídeo bloqueado desaparece de Home, busca e detalhe. O detalhe responde
  **404, não 403**: dizer "bloqueado" confirmaria que ele existe.
- Limite de **10 denúncias por hora** por conta, inclusive para `menor`.
- `is_admin` é marcado **à mão no banco**; não existe rota que promova ninguém.
- A cada 6 horas, o que a origem apagou é bloqueado aqui também.
  Ver [ADR-0017](docs/adr/0017-denuncia-remocao-e-bloqueio.md).

### Autenticação

Login real, com senha conferida no servidor ([ADR-0011](docs/adr/0011-contas-em-sqlite-limitando-a-0004.md)). Estas são as únicas rotas que não são `GET`, as únicas com corpo JSON (limite de 4kb) e todas respondem com `Cache-Control: no-store`.

| Rota                    | Corpo / cabeçalho                   | Retorna                                                                       |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/auth/login`  | `{ email, password, captchaToken }` | `{ user: { id, email, ageVerified, termsAccepted }, token, expiresAt }`       |
| `GET /api/auth/me`      | `Authorization: Bearer <token>`     | `{ user: { id, email, ageVerified, termsAccepted, isAdmin }, legalVersions }` |
| `POST /api/auth/logout` | `Authorization: Bearer <token>`     | `{ ok: true }` — apaga a sessão no banco                                      |
| `DELETE /api/auth/me`   | `Authorization: Bearer <token>`     | `{ ok: true }` — apaga a conta e todas as sessões                             |

A ordem da verificação do login é fixa: formato dos campos → captcha → bloqueio → senha. O captcha vem **antes** da senha para que força bruta não chegue de graça ao `scrypt`. Sem `RECAPTCHA_SECRET`, o captcha **não é exigido** e nem é consultado ([ADR-0014](docs/adr/0014-captcha-exigido-so-com-secret.md)): quem segura força bruta passa a ser só o bloqueio por conta, e o boot avisa isso em voz alta.

`ageVerified` e `termsAccepted` vêm na resposta para o front mandar a pessoa direto para a tela que falta, sem esperar o primeiro 403 do catálogo.

O login grava **uma linha** em `access_logs` (conta, IP e data), como exige o Marco Civil — e nada mais. Navegar pelo catálogo não gera registro: uma linha por login é registro de acesso, uma por requisição seria rastro de navegação. Ver [ADR-0018](docs/adr/0018-teto-do-cache-e-registro-de-acesso.md).

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

| Status | `code`                | Quando                                                                                                   |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_PARAMS`      | Parâmetro fora da lista permitida, ou corpo que não é JSON válido                                        |
| 400    | `CAPTCHA_FAILED`      | O Google não confirmou o token do reCAPTCHA                                                              |
| 401    | `INVALID_CREDENTIALS` | Senha errada **ou** e-mail inexistente                                                                   |
| 401    | `UNAUTHORIZED`        | Token de sessão ausente, inválido, expirado ou já desconectado                                           |
| 403    | `AGE_REQUIRED`        | Sessão válida, maioridade ainda não declarada ([ADR-0019](docs/adr/0019-idade-por-autodeclaracao.md))    |
| 403    | `TERMS_REQUIRED`      | Falta aceitar a versão vigente dos documentos ([ADR-0016](docs/adr/0016-aceite-de-termos-por-versao.md)) |
| 403    | `ADMIN_ONLY`          | Rota de moderação sem `is_admin`                                                                         |
| 404    | `NOT_FOUND`           | Vídeo inexistente, bloqueado por denúncia, ou `id` fora do padrão                                        |
| 404    | `ROUTE_NOT_FOUND`     | Rota que não existe, ou método não previsto                                                              |
| 413    | `PAYLOAD_TOO_LARGE`   | Corpo acima de 4kb em `/api/auth` ou `/api/reports`                                                      |
| 429    | `TOO_MANY_ATTEMPTS`   | Conta bloqueada por erros de senha                                                                       |
| 429    | `TOO_MANY_REPORTS`    | Mais de 10 denúncias na última hora, pela mesma conta                                                    |

| 502 | `UPSTREAM_UNAVAILABLE` | API externa respondeu erro ou caiu |
| 504 | `UPSTREAM_TIMEOUT` | API externa passou de `UPSTREAM_TIMEOUT_MS` |
| 500 | `INTERNAL_ERROR` | Qualquer outra coisa |

## Limitações conhecidas

| Limitação                                       | Detalhe                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Miniaturas em 320x180                           | A API ignora `thumbsize=large_hd` e só devolve 320x180; reescrever a URL quebra a assinatura (HTTP 471). O banner da Home fica borrado — não é bug do front. Ver [ADR-0009](docs/adr/0009-miniaturas-320x180.md)                                                                                                               |
| `poster` igual ao `backdrop`                    | A API não tem imagem vertical, então o Top 10 recebe uma imagem 16:9                                                                                                                                                                                                                                                           |
| URLs de imagem expiram em ~24h                  | São assinadas pela CDN. O cache de 10 min não é afetado, mas `Title` guardado no `localStorage` do front mostra imagem quebrada depois de um dia                                                                                                                                                                               |
| `hasMore` é estimativa                          | A API não informa o total; vale `items.length > 0 && page < 50` e pode prometer página seguinte vazia                                                                                                                                                                                                                          |
| Cache morre no reinício                         | É em memória, de propósito. No plano gratuito do Render o serviço dorme em ~15 min. Ver [ADR-0004](docs/adr/0004-nao-armazenar-nada-cache-em-memoria.md)                                                                                                                                                                       |
| `type` e `maturity` são fixos                   | `'movie'` e `'18'`: a API não distingue tipo, e todo o acervo é adulto. Ver [ADR-0006](docs/adr/0006-converter-para-o-contrato-title.md)                                                                                                                                                                                       |
| Fixtures envelhecem em silêncio                 | `test/fixtures/` guarda respostas reais de 05/11/2026; nada avisa quando a API mudar. Ver [ADR-0008](docs/adr/0008-fixtures-com-respostas-reais.md)                                                                                                                                                                            |
| A API é bloqueada por região                    | O Pornhub bloqueia vários estados dos EUA pelo IP do servidor. `/api/health` funcionando com `/api/categories` em 502 = região errada                                                                                                                                                                                          |
| Sem cadastro e sem "esqueci a senha"            | Fora do escopo: criar conta exigiria moderação, e recuperar senha exigiria enviar e-mail                                                                                                                                                                                                                                       |
| Login sem `RECAPTCHA_SECRET`                    | O captcha não é exigido, e o boot avisa. Força bruta é contida só pelo bloqueio por conta. Ver [ADR-0014](docs/adr/0014-captcha-exigido-so-com-secret.md)                                                                                                                                                                      |
| **A idade não é verificada, é declarada**       | Qualquer menor de idade entra marcando a caixa: não pedimos documento nem foto. É a decisão do projeto, com os custos escritos na [ADR-0019](docs/adr/0019-idade-por-autodeclaracao.md). Se a lei exigir verificação por meio idôneo, o caminho de volta está na [ADR-0015](docs/adr/0015-verificacao-de-idade-no-servidor.md) |
| Textos legais são rascunho                      | `src/config/legal.js` tem a versão; os textos estão no front e **não passaram por advogado**. Ver [ADR-0016](docs/adr/0016-aceite-de-termos-por-versao.md)                                                                                                                                                                     |
| Lista de bloqueados é por processo              | Fica em memória e é relida a cada 6h. Com mais de uma instância, o bloqueio feito em uma demora até um ciclo para chegar nas outras. Ver [ADR-0017](docs/adr/0017-denuncia-remocao-e-bloqueio.md)                                                                                                                              |
| Ninguém analisa a fila de denúncias             | O mecanismo está pronto, e `is_admin` não está marcado para nenhuma conta                                                                                                                                                                                                                                                      |
| Qualquer conta tira vídeo do ar                 | Dez por hora, escolhendo `menor`. É abuso fácil, e é a escolha certa: falso positivo custa um vídeo, falso negativo é crime no ar                                                                                                                                                                                              |
| O banco gratuito do Render **expira**           | `be-wiseup-one-db` (frankfurt, Postgres 17) foi criado em 06/11/2026 e expira em **06/12/2026**: o plano gratuito tem 30 dias. Depois disso, migrar para Neon/Supabase ou pagar o plano — o que muda é só `DATABASE_URL` (ADR-0013)                                                                                            |
| Acesso externo ao banco fica **fechado**        | O `ipAllowList` do Render vem vazio, e vazio significa "ninguém de fora". É o certo: a API fala pela URL interna. Para rodar os testes de SQL da sua máquina, libere o seu IP e **feche depois**                                                                                                                               |
| Origem fora do ar por mais de 1h                | O cache expirado deixa de ser servido e a resposta passa a ser 502/504, de propósito: dado inverificável pode listar vídeo já removido na origem. Ver [ADR-0018](docs/adr/0018-teto-do-cache-e-registro-de-acesso.md)                                                                                                          |
| A faxina do registro de acesso roda no processo | Uma vez por dia, por temporizador. Não há tarefa agendada por fora                                                                                                                                                                                                                                                             |

## Deploy

Render, Web Service no plano gratuito, **região fora dos EUA** (Frankfurt). Ver
[ADR-0010](docs/adr/0010-deploy-no-render-fora-dos-eua.md) para o porquê.

| Campo             | Valor              |
| ----------------- | ------------------ |
| Build Command     | `npm install`      |
| Start Command     | `npm start`        |
| Health Check Path | `/api/health`      |
| Auto-Deploy       | On Commit (`main`) |

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
├── config/
│   └── legal.js            # versão vigente dos termos e da privacidade
├── db/
│   ├── database.js         # pool do Postgres + transação (única parte com pg)
│   └── schema.sql          # users, sessions, terms_acceptances, reports,
│                           # blocked_videos e access_logs
├── http/
│   ├── errors.js           # erros com status e código
│   ├── errorHandler.js     # 404 de rota e formato único de erro
│   ├── requireAuth.js      # Authorization: Bearer → req.user
│   ├── requireAdult.js     # barra quem não declarou maioridade (AGE_REQUIRED)
│   ├── requireTerms.js     # barra termos não aceitos (403 TERMS_REQUIRED)
│   └── requireAdmin.js     # barra quem não tem is_admin
├── mappers/
│   └── videoMapper.js      # API externa → Title
├── routes/
│   ├── index.js            # rotas /api — **a ordem aqui é a regra de acesso**
│   ├── auth.js             # rotas /api/auth

│   └── reports.js          # denúncia e moderação
├── services/
│   ├── cache.js            # cache em memória (TTL + idade da entrada)
│   ├── pornhubClient.js    # única parte que chama a API externa
│   ├── videosService.js    # regras de cada endpoint + filtro de bloqueados
│   ├── password.js         # scrypt + timingSafeEqual
│   ├── captchaService.js   # confere o reCAPTCHA no Google
│   ├── usersService.js     # SQL de contas, sessões, declaração e aceites
│   ├── authService.js      # login, bloqueio e sessão

│   ├── reportsService.js   # SQL de denúncias e bloqueios
│   ├── moderationService.js # regras da denúncia (motivos, limite, bloqueio)
│   └── accessLogService.js # registro de acesso do Marco Civil
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

### 05/11/2026 — Prevenção: idade, termos, denúncia e registro de acesso

Quatro fases do plano de prevenção, no mesmo dia. O fio que liga as quatro: o
acervo é adulto e vem de terceiros, e até aqui a única barreira era um login
que não perguntava idade.

**Banco persistente ([ADR-0013](docs/adr/0013-postgres-gerenciado-no-lugar-do-sqlite.md)).**
O `node:sqlite` saiu e entrou Postgres gerenciado — `pg` é a primeira
dependência nova desde o Express, e a ADR-0003 (dependências mínimas) está
marcada como limitada por ela. O disco do Render é efêmero, e aceite de termos,
denúncia e bloqueio de vídeo **não podem** morrer a cada deploy.
**Risco encerrado em 06/11/2026:** este SQL **rodou** contra um Postgres 17
gerenciado (`be-wiseup-one-db`, frankfurt). Seis tabelas, 13 índices e os 21
testes de SQL passando — ver o diário.

**Catálogo fechado ([ADR-0012](docs/adr/0012-catalogo-exige-sessao.md)).**
Enquanto `/api/home` era público, o login do front não barrava ninguém: bastava
chamar a API direto para receber conteúdo +18 sem conta nenhuma.

**Captcha opcional ([ADR-0014](docs/adr/0014-captcha-exigido-so-com-secret.md)).**
Com o widget removido do front e o catálogo recém-fechado, exigir
`captchaToken` tornaria o login impossível — e sem login não há site. Agora o
captcha é exigido **só quando existe `RECAPTCHA_SECRET`** para conferi-lo.
Exigir um token que ninguém verifica é teatro.

**Idade verificada no servidor ([ADR-0015](docs/adr/0015-verificacao-de-idade-no-servidor.md)),
_substituída no mesmo dia pela autodeclaração — ver a entrada seguinte_.** Três
colunas em `users` e nada mais: que passou, quando e por qual método. Documento,
foto, CPF e data de nascimento **não entravam no banco** — quem verificaria era
o provedor, com webhook autenticado por HMAC-SHA256 do **corpo cru**
(`JSON.stringify` não reproduz os bytes assinados).

**Aceite por versão ([ADR-0016](docs/adr/0016-aceite-de-termos-por-versao.md)).**
Uma linha por documento e versão, e nada é apagado quando sai versão nova: é o
que responde depois "o que esta conta aceitou, e quando". A versão vigente é
constante no código, porque anda junto com o texto. A contagem de aceites vai
na **mesma consulta da sessão** — era isso ou uma terceira ida ao banco por
requisição autenticada.

**Denúncia que remove na hora ([ADR-0017](docs/adr/0017-denuncia-remocao-e-bloqueio.md)).**
`menor` e `sem_consentimento` tiram o vídeo do catálogo **antes de qualquer
análise**, na mesma transação da denúncia — daí o `db.transaction`, porque
`pool.query` pega conexão diferente a cada chamada. A denúncia fica `aberta`
mesmo com o vídeo já fora: o bloqueio vem antes da análise, não em vez dela. E
`reports.user_id` é `SET NULL`, não `CASCADE`: excluir a conta não pode apagar
denúncia de conteúdo grave.

**Teto do cache e registro de acesso ([ADR-0018](docs/adr/0018-teto-do-cache-e-registro-de-acesso.md)).**
A resposta expirada deixou de ser servida para sempre: passada uma hora, o erro
da origem sobe. Um catálogo de um dia atrás pode listar vídeo que lá já foi
removido. E `access_logs` tem três colunas — conta, IP, data —, gravado **só no
login**: não entra o que foi buscado nem o que foi assistido, e a ausência
dessas colunas é a decisão, não uma etapa para depois.

- 109 testes passando, 18 pulados (SQL, com `TEST_DATABASE_URL`), `npx eslint .`
  limpo.
- **Bug encontrado por teste de rota:** `review` com `improcede` respondia
  `blocked: true` quando nada estava bloqueado — reportava o resultado do
  desbloqueio em vez do estado do vídeo. Corrigido no mesmo commit.
- **Fora do código, e sem isso nada funciona:** cadastrar `DATABASE_URL` no
  Render, mandar os textos legais para revisão jurídica e marcar `is_admin`
  para alguém.

### 05/11/2026 — A idade passou a ser declarada, não verificada

Decisão do projeto, no mesmo dia da fase que montou a verificação por provedor:
**sem documento e sem foto**. A pessoa declara que tem 18 anos ou mais, e o
provedor saiu do código. A
[ADR-0019](docs/adr/0019-idade-por-autodeclaracao.md) registra a decisão inteira,
inclusive o que ela custa.

**Uma transação, dois registros.** `POST /api/auth/accept` grava a declaração de
maioridade e o aceite dos documentos juntos, porque na tela é uma caixa de
seleção só: não pode existir estado em que uma passou e a outra não. Ficam dois
registros distintos de propósito — a declaração em `users`, o aceite por
documento e versão em `terms_acceptances` —, para que versão nova dos textos
peça aceite novo **sem** pedir a declaração outra vez.

**O que entrou no banco:** `age_verified_at`, `age_method`
(`'autodeclaracao'`) e `age_declared_ip`. Numa declaração, a data e o IP são
toda a evidência que existe. **O que não entrou, e não vai entrar:** coluna de
documento, foto, CPF ou data de nascimento. Não é "ainda não" — é a decisão, e
um teste em `authService.test.js` falha se alguém acrescentar um campo com esse
nome.

**O adaptador morreu inteiro.** Saíram `ageService.js`, `routes/age.js`, o
webhook assinado, as quatro variáveis `AGE_*` e os testes deles — 176 linhas de
teste de provedor incluídas. Um teste novo confirma que `/api/age/*` responde
404: adaptador morto que continua aceitando requisição é pior do que adaptador
nenhum. A ADR-0015 ficou de pé, marcada como **parcialmente substituída**, e
`age_method` continua existindo justamente para que uma conta liberada por
declaração e outra por provedor possam conviver na mesma tabela se a lei exigir.

**A primeira coisa que o `app.js` deixou de fazer** foi capturar o corpo cru das
requisições (`req.rawBody`): ele existia só para conferir a assinatura do
webhook. Sem webhook, guardar o corpo cru de toda requisição seria peso e
superfície de graça.

- 98 testes passando, 21 pulados (SQL, com `TEST_DATABASE_URL`), `npx eslint .`
  limpo.
- Três testes de SQL novos em `usersService.test.js`, pulados como os outros 18
  até existir `TEST_DATABASE_URL`: a declaração gravando data/meio/IP, o clique
  único gravando as duas metades na mesma transação (e versão nova dos
  documentos pedindo aceite sem pedir declaração), e um que varre o
  `information_schema` para falhar se aparecer coluna de documento, foto, CPF ou
  data de nascimento.
- **O custo, escrito onde não dá para não ver:** autodeclaração não verifica
  nada. Qualquer menor de idade entra marcando a caixa. A proteção que resta é o
  aviso claro, a declaração registrada, o catálogo fechado por sessão
  (ADR-0012), nenhuma miniatura antes da porta e a denúncia que remove na hora
  (ADR-0017).
- **Efeito no front, no mesmo dia:** os Termos diziam que "não aceitamos
  declaração de idade por caixa de seleção". Era verdade quando foi escrito e
  virou mentira com esta decisão — reescrito no mesmo commit de lá. Documento
  legal que promete verificação inexistente é pior do que documento nenhum.

### Próximos passos

Em ordem de quem bloqueia o quê. Os dois primeiros são **impeditivos**: sem
eles, ninguém entra em produção.

O passo a passo detalhado, com o que esperar e o que fazer quando der errado,
está em
[`docs/passo-a-passo-ligar-o-login.md`](docs/passo-a-passo-ligar-o-login.md).

> **Atenção ao que está no ar hoje.** A build publicada no Render é **anterior à
> autenticação**: `GET /api/videos` responde 200 **sem token**, ou seja, o
> catálogo adulto está aberto a qualquer pessoa com a URL. A causa é o item 1
> abaixo — sem `DATABASE_URL` a build nova não sobe, e o Render mantém a
> anterior. Confira com `npm run conferir -- <url>`.

1. **Cadastrar `DATABASE_URL` e `SEED_USERS` no serviço da API e implantar.** O
   banco já existe (`be-wiseup-one-db`, frankfurt, criado em 06/11/2026), com o
   schema aplicado e testado. **É isto que destrava tudo o mais:** enquanto as
   variáveis não existirem, a build nova não sobe e o que está publicado é a
   versão aberta. Passos 2 e 3 do passo a passo.
   **Cuidado:** a variável cadastrada hoje é `CORS_ORIGIN` (singular), e o
   código lê `CORS_ORIGINS` — ela nunca teve efeito. Corrija o nome no mesmo
   momento, incluindo `http://localhost:5173` para o front em desenvolvimento
   alcançar esta API.
2. **Revisão jurídica** dos Termos e da Política de Privacidade (textos no
   repositório do front, marcados como rascunho **na própria página**). Depois
   dela, atualizar a data em `src/config/legal.js` **uma vez**.
3. **Marcar `is_admin`** para alguma conta, à mão no banco — sem isso a fila de
   denúncias não tem quem a olhe.
4. ~~Rodar os testes de SQL contra um Postgres de verdade~~ — **feito** em
   06/11/2026: 119 testes, 119 passando, nenhum pulado. Repetir depois de mexer
   em `schema.sql` ou nos serviços de SQL (passo 7 do passo a passo).
5. `CORS_ORIGINS` com a URL do front quando ele for publicado (hoje só
   `http://localhost:5173`).
6. **Captcha (opcional, ADR-0014):** registrar o site em
   <https://www.google.com/recaptcha/admin> (reCAPTCHA v2), cadastrar
   `RECAPTCHA_SECRET` aqui e voltar o widget no front. Enquanto a variável não
   existir, o captcha não é exigido e o boot avisa.
7. **Etapa 5 (front):** `VITE_AUTH_MODE=api` e o botão "Excluir minha conta".

### 06/11/2026 — Passo a passo para ligar o login, e um verificador de produção

Relato de quem usa: "qualquer e-mail e senha entra, mesmo tirando o captcha e
mantendo o banco de usuários". A causa estava no front
(`VITE_AUTH_MODE=local`, que nem chama a API), mas a investigação encontrou
**coisa pior aqui**: a build publicada no Render é anterior à autenticação.

```
GET /api/videos      → 200 com 30 títulos, sem token
POST /auth/accept    → 404
POST /auth/login     → 400 "Confirme que você não é um robô"
```

Ou seja: o catálogo adulto está aberto a qualquer pessoa com a URL, e o login de
lá exige um captcha que o front já não manda. A causa é previsível e de
propósito — sem `DATABASE_URL` o processo se recusa a subir, o deploy novo
falha, e o Render mantém no ar a build anterior. O fail-closed funcionou no
processo e **não** no serviço: o que ficou de pé foi a versão sem barreira
nenhuma.

- **`npm run conferir -- <url> [email] [senha]`** (`scripts/conferir-producao.mjs`):
  nove checagens de fora, sem depender do painel. Catálogo fechado sem sessão,
  rotas do provedor de idade em 404, `POST /auth/accept` exigindo sessão,
  credencial inválida não entrando, e — com conta — login, confirmação e
  catálogo abrindo depois dela. Devolve código 1 se algo falhar, para servir em
  CI.
- **[`docs/passo-a-passo-ligar-o-login.md`](docs/passo-a-passo-ligar-o-login.md)**:
  sete passos, cada um com o que fazer, o que esperar no log e o que fazer
  quando der errado. Inclui o prazo do Postgres gratuito do Render, o formato do
  `SEED_USERS` (é assim que a conta nasce — não há tela de cadastro) e o `UPDATE`
  do `is_admin`.
- O aviso sobre a build aberta entrou no topo dos "Próximos passos", porque é o
  tipo de coisa que se descobre tarde: o serviço responde `200 OK` no `/health`,
  o painel mostra "live", e o que está vivo é a versão errada.

### 06/11/2026 — O banco existe, e o SQL deixou de ser teoria

Postgres gerenciado criado pela API do Render: **`be-wiseup-one-db`**, versão
17, região **frankfurt** (a mesma do serviço — banco em outra região faria a
conexão sair pela internet), plano gratuito, `dpg-dbml4j3bc2fs73a9d6t0-a`.

**O schema rodou pela primeira vez**, e passou: seis tabelas (`users`,
`sessions`, `terms_acceptances`, `reports`, `blocked_videos`, `access_logs`) e
13 índices. A coluna de idade ficou como a ADR-0019 manda — `age_verified_at`,
`age_method`, `age_declared_ip` — e **nenhuma** de documento, foto, CPF ou data
de nascimento.

**Os 21 testes de SQL deixaram de ser pulados: 119 testes, 119 passando.** Eles
exercitam o que só o Postgres responde — a transação da declaração com o aceite,
o `ON CONFLICT DO NOTHING` do aceite por versão, o `CASCADE` das sessões, o `SET
NULL` das denúncias, a faxina por data em `TEXT` ISO 8601 e o registro de acesso
sobrevivendo à exclusão da conta. O risco "este SQL nunca rodou", registrado na
ADR-0013, está encerrado.

Três coisas que só apareceram contra um banco de verdade:

- **`is_admin` é `BOOLEAN`.** O `UPDATE users SET is_admin = 1` que eu havia
  escrito no passo a passo quebraria em Postgres (`= 1` num booleano é erro de
  tipo). Virou `= TRUE`. O código já estava certo (`Boolean(session.is_admin)`).
- **`ipAllowList` vazio é "ninguém de fora".** O padrão do Render bloqueia todo
  acesso externo ao banco, e é o certo — a API fala pela URL interna. Para rodar
  os testes daqui, o IP foi liberado e **fechado em seguida**.
- **`CORS_ORIGIN`, no singular, está cadastrada no serviço — e o código lê
  `CORS_ORIGINS`.** A variável nunca teve efeito: o CORS vem usando o padrão
  (`http://localhost:5173`). Entrou no passo a passo e no topo dos próximos
  passos, porque é do tipo que passa anos sem ser notado.

**O que falta, e não é código:** cadastrar `DATABASE_URL` e `SEED_USERS` no
serviço e implantar. É mudança em serviço no ar, então não passa em modo
automático — e enquanto não acontecer, o que está publicado continua sendo a
build antiga, com o catálogo aberto.
