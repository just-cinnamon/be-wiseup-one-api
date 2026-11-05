# ADR-0001 — Registrar as decisões do back-end em ADRs

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O front `be-wiseup-one` já registra suas decisões em `docs/adr/`
([ADR-0001 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0001-registrar-decisoes-em-adrs.md)),
e a prática se mostrou útil: o motivo de cada escolha está escrito, datado e com
as alternativas descartadas.

Este repositório nasceu de um guia passo a passo
(`guia-backend-be-wiseup-one-api.md`), que diz **o que** fazer mas não guarda o
**porquê** de cada escolha nem o que foi descartado. Pior: o guia é um arquivo
fora do repositório, que pode se perder ou divergir do código.

O back-end também toma decisões que não aparecem no código e são fáceis de
reverter por engano: por que não existe banco de dados, por que a conversão para
o formato do front mora aqui e não no front, por que a resposta expirada do
cache é devolvida quando a API externa falha.

## Decisão

Manter neste repositório a mesma pasta `docs/adr/`, com o mesmo template,
numeração própria (começando em 0001) e as mesmas convenções do front.

Na prática:

- um arquivo `NNNN-titulo-em-kebab-case.md` por decisão;
- `0000-template.md` copiado do front, sem alteração;
- índice em `docs/adr/README.md`, atualizado a cada ADR nova;
- ADR aceita não se reescreve: uma decisão nova substitui a antiga, que passa a
  ter o status `substituída por`;
- português do Brasil, igual ao resto da documentação e dos comentários.

As ADRs 0002 a 0010 registram, retroativamente, as decisões que o guia já havia
tomado — com o contexto e as alternativas que ele não explicitou.

## Consequências

**Positivas**

- O guia deixa de ser a única fonte do "porquê"; o repositório se explica
  sozinho.
- Decisões que parecem gratuitas no código (cache que devolve dado velho,
  `maturity` fixo em `'18'`) ficam justificadas onde quem for mexer vai olhar.
- Mesma convenção dos dois repositórios: quem leu as ADRs do front já sabe ler
  as daqui.

**Negativas / custos aceitos**

- Duas sequências de numeração independentes: "ADR-0004" é ambíguo sem dizer de
  qual repositório. Os links entre repositórios precisam ser explícitos.
- Documentação para manter em dia. ADR esquecida é pior que ADR inexistente,
  porque dá a impressão de estar completa.

## Alternativas consideradas

- **Só o README** — já tem endpoints, variáveis e diário de progresso. Mas
  README descreve o estado atual; não guarda o que foi descartado nem por quê.
- **ADRs centralizadas num repositório de documentação** — evitaria a numeração
  dupla, mas afastaria a decisão do código que ela afeta.
- **Manter o guia como documentação** — ele é um tutorial de criação, com
  instruções de uma única execução ("crie o repositório", "rode npm install").
  Não serve de registro vivo e já divergiu do código (ver
  [ADR-0008](0008-fixtures-com-respostas-reais.md) e
  [ADR-0009](0009-miniaturas-320x180.md)).

## Referências

- `docs/adr/0000-template.md`, `docs/adr/README.md`
- ADRs do front: `be-wiseup-one/docs/adr/`
- `E:\Wiseup\guia-backend-be-wiseup-one-api.md` (guia de origem)
