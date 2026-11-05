# be-wiseup-one-api

Back-end do [be-wiseup-one](https://github.com/just-cinnamon/be-wiseup-one). Busca vídeos na Webmasters API do Pornhub e entrega ao front no mesmo formato dos dados fictícios (`Title`).

**Não armazena vídeos nem dados de usuário.** Os vídeos são exibidos pelo embed oficial; o back-end só repassa e converte metadados, com um cache em memória de 10 minutos.

## Stack

Node.js 22 · Express 5 · cors · testes com `node:test` · ESLint + Prettier

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

## Endpoints

| Rota | Retorna |
| --- | --- |
| `GET /api/health` | `{ "status": "ok" }` |
| `GET /api/home` | `{ featured, top10, rows: [{ id, title, items }] }` |
| `GET /api/videos?q=&category=&ordering=&period=&page=` | `{ page, items, hasMore }` |
| `GET /api/videos/:id` | `Title` + `tags`, `views`, `publishedAt`, `embedUrl` |
| `GET /api/categories` | `[{ id, slug, name }]` |

Valores aceitos: `ordering` = `featured`, `newest`, `mostviewed`, `rating` · `period` = `weekly`, `monthly`, `alltime` · `page` = 1 a 50 · `q` até 80 caracteres.

Erros: `{ "error": { "code": "...", "message": "..." } }` com `400 INVALID_PARAMS`, `404 NOT_FOUND`, `404 ROUTE_NOT_FOUND`, `502 UPSTREAM_UNAVAILABLE`, `504 UPSTREAM_TIMEOUT`, `500 INTERNAL_ERROR`.

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

## Deploy

Render, Web Service no plano gratuito, **região fora dos EUA** (Frankfurt). Ver
[ADR-0010](docs/adr/0010-deploy-no-render-fora-dos-eua.md) para o porquê.

| Campo | Valor |
| --- | --- |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Auto-Deploy | On Commit (`main`) |

Variáveis a cadastrar: `NODE_VERSION=22` (obrigatória) e `CORS_ORIGINS` com a
URL do front publicado. **Não** cadastre `PORT`: o Render define sozinho.

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
├── http/
│   ├── errors.js           # erros com status e código
│   └── errorHandler.js     # 404 de rota e formato único de erro
├── mappers/
│   └── videoMapper.js      # API externa → Title
├── routes/
│   └── index.js            # rotas /api
├── services/
│   ├── cache.js            # cache em memória (TTL)
│   ├── pornhubClient.js    # única parte que chama a API externa
│   └── videosService.js    # regras de cada endpoint
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

### Próximos passos
- Deploy no Render (seção "Deploy") e `CORS_ORIGINS` com a URL do front.
- Integração no front: `VITE_API_BASE_URL`, `src/services/api.js` e `Home.jsx`
  consumindo `getHome()`.
