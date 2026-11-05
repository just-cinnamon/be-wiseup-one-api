# Decisões de arquitetura (ADRs)

Esta pasta guarda os **ADRs** (_Architecture Decision Records_) do
`be-wiseup-one-api`: um arquivo por decisão técnica relevante, explicando **o
contexto**, **o que foi decidido** e **as consequências** daquela escolha.

Mesma prática do front
([ADRs do be-wiseup-one](https://github.com/just-cinnamon/be-wiseup-one/tree/main/docs/adr)),
com numeração própria. A ideia é que ninguém precise adivinhar por que este
projeto guarda conta mas não guarda catálogo, por que o cache devolve dado
vencido quando a API externa falha, ou por que o banner da Home fica borrado.

## Índice

| ADR | Decisão | Status | Data |
| --- | ------- | ------ | ---- |
| [0001](0001-registrar-decisoes-em-adrs.md) | Registrar as decisões do back-end em ADRs | Aceita | 2026-11-05 |
| [0002](0002-back-end-proprio-como-intermediario.md) | Back-end próprio entre o front e a Webmasters API | Aceita | 2026-11-05 |
| [0003](0003-node-22-express-5-minimo-de-dependencias.md) | Node 22 e Express 5 com o mínimo de dependências | Aceita | 2026-11-05 |
| [0004](0004-nao-armazenar-nada-cache-em-memoria.md) | Não armazenar nada: só cache em memória, que devolve dado velho no erro | Aceita | 2026-11-05 |
| [0005](0005-camadas-client-mapper-service.md) | Camadas client / mapper / service, com as regras fora do Express | Aceita | 2026-11-05 |
| [0006](0006-converter-para-o-contrato-title.md) | Converter no back-end para o contrato `Title` do front | Aceita | 2026-11-05 |
| [0007](0007-erros-padronizados-e-validacao-por-allowlist.md) | Formato único de erro e validação por lista de valores permitidos | Aceita | 2026-11-05 |
| [0008](0008-fixtures-com-respostas-reais.md) | Fixtures com respostas reais da API externa | Aceita | 2026-11-05 |
| [0009](0009-miniaturas-320x180.md) | Aceitar miniaturas de 320x180 como limite da API | Aceita | 2026-11-05 |
| [0010](0010-deploy-no-render-fora-dos-eua.md) | Deploy no Render, em região fora dos Estados Unidos | Aceita | 2026-11-05 |
| [0011](0011-contas-em-sqlite-limitando-a-0004.md) | Guardar contas em SQLite, limitando a ADR-0004 | Aceita | 2026-11-05 |
| [0012](0012-catalogo-exige-sessao.md) | O catálogo só responde com sessão, e o app não sobe sem autenticação | Aceita | 2026-11-05 |

## Como criar uma nova ADR

1. Copie [`0000-template.md`](0000-template.md) para `NNNN-titulo-curto.md`,
   usando o **próximo número livre** (não reaproveite números).
2. Preencha contexto, decisão, consequências e alternativas.
3. Comece com o status **proposta**; mude para **aceita** quando a decisão
   valer para o código.
4. Adicione a linha no índice acima.

## Como mudar uma decisão

ADR aceita **não se reescreve**. Crie uma nova ADR com a decisão nova e:

- na ADR antiga, troque o status para `substituída por [ADR-NNNN](...)`;
- na ADR nova, cite qual ADR ela substitui e o que mudou no contexto.

O histórico de por que mudamos de ideia é tão útil quanto a decisão em si.

## Convenções

- **Idioma:** português, igual ao resto da documentação e dos comentários.
- **Nome do arquivo:** `NNNN-titulo-em-kebab-case.md`, número com 4 dígitos.
- **Tamanho:** uma página. Se passar disso, provavelmente são duas decisões.
- **Numeração separada da do front:** ao citar uma ADR do outro repositório,
  escreva "ADR-0007 do front" e use link absoluto.
