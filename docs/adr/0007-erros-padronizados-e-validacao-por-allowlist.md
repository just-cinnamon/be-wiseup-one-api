# ADR-0007 — Formato único de erro e validação por lista de valores permitidos

- **Status:** aceita, com a parte "Só `GET` existe" **substituída parcialmente**
  por [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md) — as rotas de
  `/api/auth` usam `POST` e `DELETE`, e a tabela de erros ganhou quatro códigos;
  o resto segue valendo
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O front precisa reagir a falha: mostrar mensagem e um botão "Tentar novamente".
Para isso, toda resposta de erro tem que ter a **mesma forma** — senão cada tela
inventa seu tratamento.

E os parâmetros do front viram parte de uma URL enviada a um serviço de
terceiros (`/webmasters/search?...`). Repassar query string sem filtro é
convite a problema: parâmetro inesperado que muda o comportamento da API
externa, `id` com `../` tentando sair da rota, busca gigante usada para abusar
do serviço.

Os erros também vêm de fontes diferentes: parâmetro inválido (culpa de quem
chamou), vídeo inexistente, API externa fora do ar, API externa lenta, e bug
nosso. Cada um merece status HTTP diferente, mas a forma do JSON deve ser uma.

## Decisão

**Um formato de erro** e **validação por lista de valores permitidos** em todo
parâmetro, de entrada e de saída.

Formato, sempre (`src/http/errors.js` + `src/http/errorHandler.js`):

```json
{ "error": { "code": "INVALID_PARAMS", "message": "page deve ser de 1 a 50." } }
```

| Status | `code` | Quando |
| --- | --- | --- |
| 400 | `INVALID_PARAMS` | parâmetro fora da lista permitida |
| 404 | `NOT_FOUND` | vídeo inexistente, ou `id` fora do padrão |
| 404 | `ROUTE_NOT_FOUND` | rota que não existe, ou método diferente de `GET` |
| 502 | `UPSTREAM_UNAVAILABLE` | API externa respondeu erro ou caiu |
| 504 | `UPSTREAM_TIMEOUT` | API externa passou de `UPSTREAM_TIMEOUT_MS` |
| 500 | `INTERNAL_ERROR` | qualquer outra coisa |

`AppError` carrega `status` e `code`; o `errorHandler` do Express transforma em
JSON. Erro que não é `AppError` vira 500 com mensagem genérica, e o erro real só
aparece no log do servidor — nunca na resposta.

Validação, em duas camadas:

- **entrada** (`videosService.js`): `ordering` e `period` só aceitam valores de
  uma lista fixa; `page` é inteiro de 1 a 50; `q` tem no máximo 80 caracteres;
  `category` precisa casar `^[a-z0-9-]{1,60}$`; `id` precisa casar
  `^[A-Za-z0-9_]{1,40}$`;
- **saída** (`pornhubClient.js`): `ALLOWED_PARAMS` é uma lista fechada de sete
  nomes. Qualquer chave fora dela é **descartada** ao montar a URL da API
  externa, mesmo que tenha passado pela validação de entrada.

Só `GET` existe: o `cors` é configurado com `methods: ['GET']` e nenhuma rota
registra outro verbo.

## Consequências

**Positivas**

- O front tem um único tratamento de erro (`ApiError` em `src/services/api.js`),
  e as mensagens já chegam em português, prontas para exibir.
- A segunda camada (`ALLOWED_PARAMS`) é o que de fato protege a API externa: um
  bug de validação na entrada não vaza parâmetro arbitrário para fora.
- `id` com `../` responde 404 sem nem chamar a API externa — verificado com
  `curl.exe "/api/videos/%2E%2E%2Fetc"`.
- 502 e 504 separados permitem ao front distinguir "fora do ar" de "demorou",
  que no plano gratuito do Render é a diferença entre erro e serviço acordando.
- Erro inesperado não expõe _stack trace_ nem caminho de arquivo na resposta.

**Negativas / custos aceitos**

- A lista fixa precisa ser atualizada à mão se a API externa ganhar um valor de
  `ordering` ou `period` novo; até lá, o valor novo responde 400.
- `page` limitado a 50 é arbitrário, não vem da API externa. E `hasMore` é um
  chute: `items.length > 0 && page < 50`, ou seja, pode prometer página seguinte
  que vem vazia.
- Mensagens de erro em português fixo no servidor: internacionalizar exigiria
  mudar a estratégia (mandar só o `code` e traduzir no front).
- Texto de erro revela as regras internas ("ordering deve ser: featured,
  newest, ..."). Aqui é desejável, por ser API de uso próprio.
- `id` inválido responde 404 e não 400, embora seja erro de formato. Escolha
  deliberada — não distinguir "id malformado" de "vídeo que não existe" evita
  usar a API para descobrir quais formatos de id existem.

## Alternativas consideradas

- **Zod ou Joi para validar** — daria mensagens e esquemas melhores, mas soma
  dependência contra a decisão de
  [ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md); são cinco
  parâmetros em uma função.
- **Lista de bloqueio em vez de lista de permissão** — sempre fica uma brecha
  que ninguém previu; com a permissão explícita, o desconhecido é descartado por
  padrão.
- **Repassar a query string inteira para a API externa** — menos código, mas
  deixaria quem chama controlar a requisição que sai deste servidor.
- **Repassar o status da API externa direto** (502 → 502) — perderia a distinção
  entre "a API externa falhou" e "este servidor falhou", e exporia o
  comportamento do serviço de terceiros ao front.
- **Corrigir silenciosamente parâmetro inválido** (`page=0` → `page=1`) — mais
  tolerante, mas esconde bug do front, que passaria a receber dados que não pediu.

## Referências

- `src/http/errors.js`, `src/http/errorHandler.js`
- `src/services/videosService.js` → `parseListQuery`, `ID_PATTERN`, `CATEGORY_PATTERN`
- `src/services/pornhubClient.js` → `ALLOWED_PARAMS`
- `test/videosService.test.js` → "listVideos rejeita parâmetros inválidos com 400"
- `test/client.test.js` → "monta a URL só com parâmetros permitidos", "erros viram 502 e 504"
- `README.md` → seção "Endpoints" (tabela de erros)
