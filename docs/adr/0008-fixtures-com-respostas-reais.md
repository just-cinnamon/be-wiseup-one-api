# ADR-0008 — Fixtures com respostas reais da API externa

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

A Webmasters API não tem documentação oficial mantida. As primeiras fixtures de
`test/fixtures/` foram escritas **à mão**, a partir de documentação pública de
terceiros, e os testes passavam (16 verdes) contra dados que ninguém havia
comparado com a realidade.

Ao salvar respostas de verdade, três divergências apareceram:

| Campo | Fixture escrita à mão | Resposta real |
| --- | --- | --- |
| `video_id` | `"ph5f0000000001"` | `"6ae9db5a2d16a"` (hash, sem prefixo `ph`) |
| `rating` | `"87.6"` (texto) | `85.5491` (número) |
| `thumbs` | 2 tamanhos, até 1280x720 | 16 miniaturas, **todas** 320x180 |

E uma quarta, nos dados que o código já convertia: a categoria `18-25` virava
`"18"`, porque a regra que limpava o sufixo de desempate (`60fps-1` → `60fps`)
comia qualquer `-número` no fim do slug.

Nenhuma dessas quebrou os testes, porque os testes conferiam a fixture inventada.

## Decisão

As fixtures passam a ser **respostas reais da API**, salvas em arquivo, e os
casos-limite que a realidade não oferece são montados dentro do teste.

Na prática:

- `test/fixtures/search.json` — resposta real de
  `search?ordering=newest&thumbsize=large_hd`, cortada nos **3 primeiros
  vídeos**, com 2 miniaturas cada (a resposta inteira tem 30 vídeos e 170KB);
- `test/fixtures/video_by_id.json` — resposta real de `video_by_id`, miniaturas
  cortadas do mesmo jeito;
- `test/fixtures/categories.json` — resposta real e **completa** de
  `categories`: 243 categorias, incluindo os slugs esquisitos (`18-25`,
  `college-18-1`, `virtual-reality-1`) que motivaram a correção;
- os testes derivam o que podem da fixture (`FIXTURE_VIDEOS`, `FIRST_ID`) em vez
  de repetir valores literais, para que trocar a fixture não quebre tudo;
- vídeo **sem** `thumbs`, `tags`, `categories` ou `publish_date` passou a ser um
  objeto escrito dentro de `test/videoMapper.test.js`, já que todo vídeo real
  traz esses campos. A cobertura dos fallbacks continua.

Os testes subiram de 16 para 19.

## Consequências

**Positivas**

- Os testes conferem o formato que a API realmente devolve, não o que a
  documentação diz.
- A troca revelou duas correções de verdade em `videoMapper.js`: o sufixo de
  categoria (ver abaixo) e a leitura de data como UTC, que fazia `publishedAt`
  variar com o fuso do servidor.
- Os 243 slugs reais de `categories.json` servem de caso de teste para
  `formatCategory`, de graça.
- Quem for mexer no mapper vê dado real e entende por que cada fallback existe.

**Negativas / custos aceitos**

- **As fixtures envelhecem.** Já envelheceram uma vez; vão envelhecer de novo, e
  nada avisa. Só uma nova comparação manual com a API detecta.
- **As URLs de miniatura dentro das fixtures estão assinadas e expiradas**
  (`hdnea=...~exp=...`, validade de ~24h). Não atrapalha — nenhum teste baixa
  imagem — mas é lixo que parece válido.
- As fixtures ficaram maiores: `categories.json` passou de 0,2KB para 15KB.
- Os títulos reais dos vídeos (conteúdo adulto explícito) estão versionados em
  arquivo de teste. Inerente ao projeto, mas aparece em `git grep` e em revisão
  de código.
- Cortar 30 vídeos para 3 e 16 miniaturas para 2 é uma edição manual: a fixture
  não é mais, ao pé da letra, "a resposta da API".
- Os valores conferidos nos testes (`'6ae9db5a2d16a'`, `16min`, `match: 86`)
  pertencem a um vídeo específico. Trocar a fixture obriga a recalcular esses
  valores à mão.

## Correções que esta troca motivou

- **`formatCategory`** passou a limpar só o sufixo `-1` (o desempate de slug
  repetido), e a devolver faixas numéricas intactas: `18-25` → `"18-25"` em vez
  de `"18"`; `college-18` e `college-18-1` agora dão o mesmo `"College 18"`.
- **`parseDate`** passou a ler a data da API como UTC, e `year` usa
  `getUTCFullYear()`. Antes, `publish_date: "2026-11-03 20:30:07"` podia virar
  `publishedAt: "2026-11-04"` dependendo do fuso de quem rodava.

## Alternativas consideradas

- **Manter as fixtures escritas à mão** — menores, estáveis e com casos-limite
  caprichados. Mas é testar o código contra a suposição de quem o escreveu,
  que foi exatamente o que falhou.
- **Chamar a API de verdade nos testes** — detectaria qualquer mudança no mesmo
  dia, ao custo de testes que dependem de rede, de região (a API é bloqueada em
  vários estados dos EUA) e que falham por motivo alheio ao código.
- **Gravar e repetir requisições (VCR / nock)** — bom meio-termo, mas soma
  dependência contra [ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md).
- **Salvar a resposta completa, sem cortar** — fiel de verdade, mas 170KB de
  fixture por arquivo e 16 miniaturas por vídeo para testar duas.
- **Teste agendado que só compara o formato da API com a fixture** — resolveria o
  envelhecimento silencioso. Próximo passo natural, ainda não feito.

## Referências

- `test/fixtures/search.json`, `test/fixtures/video_by_id.json`, `test/fixtures/categories.json`
- `test/videoMapper.test.js`, `test/videosService.test.js`, `test/helpers.js`
- `src/mappers/videoMapper.js` → `formatCategory`, `parseDate`
- [ADR-0009](0009-miniaturas-320x180.md) (as miniaturas 320x180 descobertas aqui)
- Guia de origem, seção 8 ("Trocar as fixtures por respostas reais")
