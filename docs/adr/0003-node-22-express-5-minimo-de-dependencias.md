# ADR-0003 — Node 22 e Express 5 com o mínimo de dependências

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O back-end faz pouca coisa: quatro rotas `GET`, uma chamada HTTP de saída, uma
conversão de formato e um cache em memória. Não tem autenticação, banco,
upload, fila nem WebSocket.

O front já definiu duas coisas que valem aqui: **JavaScript com JSDoc, sem
TypeScript** ([ADR-0003 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0003-javascript-sem-typescript.md))
e `node_modules`/`package-lock.json` fora do versionamento. Quem mantém o
projeto é uma pessoa, em Windows + PowerShell + VS Code.

O Node 22 absorveu o que antes exigia biblioteca: `fetch`, `node:test`,
`--watch`, `--env-file-if-exists`, `AbortSignal.timeout`.

## Decisão

Node 22.9+ com Express 5, **duas** dependências de produção (`express`, `cors`)
e nada além do que o Node já traz.

Na prática:

| Precisaria de | Usa-se |
| --- | --- |
| dotenv | `node --env-file-if-exists=.env` |
| nodemon | `node --watch` |
| axios / node-fetch | `fetch` global |
| Jest / Vitest | `node:test` + `node:assert/strict` |
| p-timeout | `AbortSignal.timeout(ms)` |

- `"type": "module"` no `package.json`: `import`/`export` em todos os arquivos;
- `"engines": { "node": ">=22.9" }` e `.nvmrc` com `22`;
- ESLint 9 (flat config) e Prettier como únicas ferramentas de qualidade,
  mesmas regras do front;
- JavaScript puro com comentários JSDoc, sem TypeScript;
- Express 5, que já repassa erros de função `async` ao tratador de erro — sem
  `express-async-handler` nem `try/catch` em cada rota.

## Consequências

**Positivas**

- `npm install` instala 2 pacotes de produção: deploy rápido e pouca superfície
  para vulnerabilidade de dependência.
- Sem etapa de build: `npm start` roda o que está escrito. O que falha em
  produção é o mesmo código que roda local.
- `node --test` já dá execução paralela e relatório; sem `jest.config`.
- Mesma linguagem e mesmas regras de lint dos dois repositórios.

**Negativas / custos aceitos**

- **Piso de versão alto.** `--env-file-if-exists` é 22.9+; abaixo disso
  `npm run dev` nem inicia. Por isso `NODE_VERSION=22` tem que estar nas
  variáveis do Render.
- Sem tipos: o formato da API externa e o contrato `Title` só são garantidos
  pelos testes (o mesmo custo aceito no front).
- `node:test` é mais cru que o Jest: sem `jest.mock` nem snapshot. As injeções
  de dependência existem em parte para compensar isso (ver
  [ADR-0005](0005-camadas-client-mapper-service.md)).
- Express 5 é recente; parte dos exemplos na internet ainda é do 4, e
  `req.query` deixou de aceitar sintaxe estendida.
- Sem `package-lock.json` no Git, dois `npm install` em datas diferentes podem
  trazer _patches_ distintos. Risco aceito por coerência com o front e reduzido
  por haver só duas dependências.

## Alternativas consideradas

- **TypeScript** — tipar a resposta da API externa teria valor real, mas somaria
  build, `tsconfig`, mapas de origem e a divergência entre o código publicado e
  o código escrito. Decisão herdada do front, por coerência.
- **Fastify** — mais rápido e com validação de esquema embutida. O ganho de
  desempenho é irrelevante nesta escala, e o Express é o que a pessoa que mantém
  o projeto conhece.
- **Node puro, sem Express** — possível com `node:http`, mas rotas, parsing de
  query e CORS viriam na mão; o `cors` já resolve uma parte sensível.
- **Express 4** — mais exemplos disponíveis, mas obrigaria `try/catch` ou um
  pacote extra em cada rota `async`.

## Referências

- `package.json`, `.nvmrc`, `eslint.config.js`, `.prettierrc`
- `src/services/pornhubClient.js` (`fetch` + `AbortSignal.timeout`)
- `src/http/errorHandler.js` (erros `async` do Express 5)
- `README.md` → seções "Stack" e "Scripts"
