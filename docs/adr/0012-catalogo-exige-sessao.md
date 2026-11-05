# ADR-0012 — O catálogo só responde com sessão, e o app não sobe sem autenticação

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 0 do plano de prevenção (`plano-prevencao-bewise-one.md`,
  fora dos repositórios por cobrir os dois)

## Contexto

Até aqui, `GET /api/home`, `/api/videos`, `/api/videos/:id` e `/api/categories`
respondiam a qualquer requisição. A [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md)
trouxe contas e sessões, mas as usou **só** em `/api/auth`.

O efeito disso é que o login do front era uma porta de vidro: ele barra quem
abre o site, e não barra quem chama a API direto. Uma linha de `curl` entregava
o catálogo inteiro — conteúdo **+18** — sem conta, sem idade verificada e sem
aceite de termos. Qualquer defesa construída na frente (verificação de idade,
termos, denúncia) vale zero enquanto existe esse caminho paralelo.

Havia também o caminho de cache: as respostas iam com `Cache-Control: public`,
o que autoriza proxy e CDN a guardar e reentregar uma cópia a terceiros.

## Decisão

**Tudo que não é `/health` nem `/api/auth` exige `Authorization: Bearer`.**

Em `src/routes/index.js`, o `requireAuth` é montado **no meio** do roteador: o
que vem registrado antes dele fica aberto, o que vem depois exige sessão. A
ordem do arquivo passou a ser a própria regra de acesso, legível de cima para
baixo.

Duas consequências de desenho:

- **Fail-closed:** `createRoutes` **lança** se receber `authService` vazio. Sem
  o serviço não há como exigir sessão, e a resposta certa é o processo não
  subir — não servir o catálogo para todo mundo. Um `if (authService)` em volta
  da proteção seria a mesma falha com outra aparência.
- **`Cache-Control: private`** nas rotas de catálogo, no lugar de `public`. A
  resposta agora depende de quem pediu; o navegador de quem pediu continua
  guardando por 5 minutos, mas nenhum intermediário pode redistribuir.

`/health` fica aberta porque é o que o provedor consulta, e não devolve dado.
`/api/auth` fica aberta por necessidade: é por ela que se obtém a sessão.

## Consequências

**Positivas**

- O login deixa de ser decorativo no que importa: sem token, não há catálogo.
- Verificação de idade, aceite de termos e lista de bloqueio passam a ter onde
  se apoiar — todas dependem de saber **quem** está pedindo.
- Nenhuma miniatura +18 sai da API para requisição anônima.
- Teste de rota cobre o 401, em `test/routes.test.js`, sem dependência nova:
  o app sobe em porta livre (`listen(0)`) e o `fetch` do Node faz as chamadas.

**Negativas / custos aceitos**

- **O front precisa mandar o token em toda chamada.** Enquanto ele estiver com
  `VITE_AUTH_MODE=local`, o token é `null` e a API recusa tudo: os dois
  repositórios passam a ter de subir juntos.
- Resposta de catálogo não pode mais ser guardada por CDN, o que aumenta a
  carga no plano gratuito do Render.
- `/health` continua aberta e revela que o serviço existe.

## O que esta ADR **não** resolve

O segundo problema da Fase 0 continua em pé: **o disco do Render é efêmero**.
Contas, denúncias e aceites são recriados ou perdidos a cada deploy. Isso é
decisão com custo — disco persistente pago (mantém `node:sqlite`) ou Postgres
gerenciado (adiciona `pg` e reescreve `src/db/database.js`, contra a
[ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md)) — e será uma ADR
própria. Até ela existir, nada que precise durar pode ser considerado durável.

## Alternativas consideradas

- **Deixar `/api/categories` aberta**, por ser só uma lista de nomes — a lista
  de categorias de um site adulto já descreve o acervo. Não compensa a exceção.
- **Chave de API fixa no front** em vez de sessão por usuário — reaparece no
  pacote que o navegador baixa, e não identifica ninguém: não serviria para
  idade nem para aceite de termos.
- **Proteger no front, com rota só no servidor** — era o estado anterior, e é
  exatamente o que a linha de `curl` desmonta.

## Referências

- `src/routes/index.js`, `src/http/requireAuth.js`, `test/routes.test.js`
- [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md) — a sessão que isto usa
- [ADR-0007](0007-erros-padronizados-e-validacao-por-allowlist.md) — o formato
  do erro devolvido no 401
