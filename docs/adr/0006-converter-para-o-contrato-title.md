# ADR-0006 — Converter no back-end para o contrato `Title` do front

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O front foi construído sobre um objeto chamado `Title`, inventado antes de
existir API e tratado como contrato
([ADR-0007 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0007-dados-ficticios-como-contrato-da-api.md)):
`id`, `title`, `type`, `backdrop`, `poster`, `year`, `maturity`, `duration`,
`genres`, `match`, `description`, `isNew?`, `progress?`. `Hero`, `Row`,
`TitleCard` e `Top10Card` consomem esse objeto.

A API externa devolve outra coisa: `video_id`, `duration: "16:41"`,
`views: 70775`, `rating: 85.5491`, `publish_date: "2026-11-03 20:30:07"`,
`thumbs: [...]`, `categories: [{ category: 'babe' }]`, `tags`, com títulos
contendo entidades HTML (`&amp;`, `&#237;`).

Alguém precisa converter. O plano anterior do front previa um `mappers.js` lá.

## Decisão

A conversão acontece **no back-end**, em `src/mappers/videoMapper.js`, e o front
recebe `Title` pronto. O `mappers.js` previsto no front deixa de existir.

As decisões de conversão, uma a uma:

| Campo do front | De onde vem |
| --- | --- |
| `id` | `video_id` (também é o `viewkey`, então serve para o `embedUrl`) |
| `title` | `title` com entidades HTML decodificadas |
| `type` | fixo `'movie'`: a API não distingue série de filme |
| `backdrop` / `poster` | maior miniatura de `thumbs`, com `default_thumb` e `thumb` como reserva. **A mesma imagem nos dois**: a API não tem versão vertical (ver [ADR-0009](0009-miniaturas-320x180.md)) |
| `year` | ano de `publish_date`, lido como UTC |
| `maturity` | fixo `'18'`: todo o acervo é adulto |
| `duration` | `"16:41"` → `"16min"`, `"1:05:20"` → `"1h 05min"`, mínimo de `1min` |
| `genres` | até 3 `categories`, slug virando nome (`big-tits` → `Big Tits`) |
| `match` | `rating` arredondado e limitado a 0–100 |
| `description` | `"70,8 mil de visualizações · tag, tag, tag"` (até 3 tags) |
| `isNew` | publicado há menos de 30 dias |
| `progress` | **não vem**: é histórico local, do `localStorage` do front |

`toTitleDetail` acrescenta o que só o modal usa: `tags` (todas), `views` (número
cru), `publishedAt` e `embedUrl`.

Duas regras para manter isso sustentável:

- `videoMapper.js` é o **único** arquivo que conhece os nomes dos campos da API
  externa (ver [ADR-0005](0005-camadas-client-mapper-service.md));
- datas da API (`"AAAA-MM-DD HH:MM:SS"`, sem fuso) são lidas como **UTC**, para
  que `year` e `publishedAt` não mudem entre o micro local (UTC−3) e o servidor
  em Frankfurt (UTC+1).

## Consequências

**Positivas**

- `Hero`, `Row`, `TitleCard` e `Top10Card` não mudaram nenhuma linha na troca do
  mock pela API: a aposta do contrato se pagou.
- Trocar ou somar fonte de dados não toca no front — só nasce outro mapper.
- Formatação de número e data em português (`"70,8 mil"`, `"1h 05min"`) fica
  resolvida no servidor, igual para todo mundo, sem depender do locale do
  navegador.
- Funções puras e pequenas: `formatDuration`, `formatViews`, `formatCategory` e
  `decodeHtml` são testadas isoladamente, inclusive os casos esquisitos.
- A resposta que viaja até o navegador é bem menor que a da API externa, que traz
  16 miniaturas e campos não usados por vídeo.

**Negativas / custos aceitos**

- **`type` e `maturity` são mentira útil.** São constantes para satisfazer um
  contrato pensado para um catálogo de filmes e séries. Se o front ganhar filtro
  por tipo, não há dado real atrás dele.
- `poster` e `backdrop` apontam para a **mesma** imagem horizontal: o
  `Top10Card`, desenhado para pôster vertical, exibe uma imagem 16:9.
- Informação é descartada na conversão: `genres` corta em 3 de até 9 categorias,
  `description` em 3 de 13 tags.
- `match` é um número de 0 a 100 apresentado como "% de compatibilidade" no
  front, mas é a nota média do vídeo — não tem nada de personalizado.
- Texto formatado dentro de `description` é inflexível: o front não consegue
  mostrar só as visualizações, ou só as tags, sem quebrar a string.
- Se o front mudar o contrato `Title`, o back-end precisa mudar junto: o
  acoplamento foi movido, não eliminado.

## Alternativas consideradas

- **Converter no front** (o `mappers.js` do plano antigo) — deixaria o back-end
  como proxy puro, mas espalharia o conhecimento do formato externo pelo front e
  mandaria pela rede respostas muito maiores.
- **Devolver o JSON cru da API externa** — zero manutenção de mapper, ao custo de
  reescrever os quatro componentes do front e perder o trabalho da Fase 1.
- **Contrato novo, desenhado a partir da API externa** — mais honesto (sem
  `type` nem `maturity` falsos), mas exigiria refazer os componentes do front e
  jogar fora a decisão que viabilizou as Fases 1 a 3.
- **Mandar `views` e `rating` crus e formatar no front** — daria flexibilidade de
  exibição, mas duplicaria a formatação em português nos dois repositórios e
  quebraria o contrato `Title`, que pede texto pronto.

## Referências

- `src/mappers/videoMapper.js`
- `test/videoMapper.test.js`
- `be-wiseup-one/src/data/mock.js` (definição do `Title`)
- [ADR-0007 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0007-dados-ficticios-como-contrato-da-api.md)
