# ADR-0002 — Back-end próprio entre o front e a Webmasters API

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O front precisa de catálogo de vídeos. A fonte escolhida é a **Webmasters API**
do Pornhub: pública, sem chave de API, devolve JSON.

O caminho mais curto seria o front chamar essa API direto do navegador. Três
problemas impedem:

1. **CORS.** A Webmasters API não envia `Access-Control-Allow-Origin`, então o
   navegador bloqueia a resposta. O front contornava isso com um proxy no
   `vite.config.js`, que só existe no servidor de desenvolvimento do Vite — em
   produção (Vercel) não há proxy.
2. **Formato.** O front foi construído sobre o objeto `Title`
   ([ADR-0007 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0007-dados-ficticios-como-contrato-da-api.md)),
   que não se parece com a resposta da API externa. Alguém tem que converter.
3. **Quantidade de chamadas.** A Home tem destaque, Top 10 e seis fileiras: oito
   buscas. Feitas do navegador, são oito requisições por visita, sem cache
   compartilhado entre quem acessa.

## Decisão

Criar um back-end próprio — um **BFF** (_Backend For Frontend_) — como único
ponto de contato com a API externa. O front só conhece este back-end.

Na prática:

- o front chama `/api/home`, `/api/videos`, `/api/videos/:id`,
  `/api/categories`, e nada mais;
- `/api/home` resolve as oito buscas da Home em paralelo e devolve **uma**
  resposta pronta (`src/services/videosService.js`, `getHome`);
- o CORS é liberado aqui, para as origens de `CORS_ORIGINS`;
- a conversão para `Title` acontece aqui (ver
  [ADR-0006](0006-converter-para-o-contrato-title.md));
- o cache em memória é compartilhado por todo mundo que acessa (ver
  [ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md));
- o front perde o proxy do `vite.config.js` e o `mappers.js` que estavam no
  plano anterior.

## Consequências

**Positivas**

- Funciona igual em desenvolvimento e em produção: sem truque de proxy que
  existe só no Vite.
- A Home virou **uma** requisição. Se uma das oito buscas falhar, a fileira vem
  vazia e o resto da página aparece (`Promise.allSettled`).
- O cache serve todas as pessoas que acessam, não cada navegador separadamente.
- Trocar a API externa, ou somar uma segunda fonte, mexe em um arquivo
  (`src/services/pornhubClient.js`) sem tocar no front.
- O front nunca vê a URL nem o formato da API externa.

**Negativas / custos aceitos**

- Mais uma peça para publicar, monitorar e manter acordada. No plano gratuito do
  Render o serviço dorme em ~15 min de inatividade e a primeira chamada depois
  disso leva cerca de um minuto (ver
  [ADR-0010](0010-deploy-no-render-fora-dos-eua.md)).
- Mais um ponto de falha entre o front e os dados.
- A latência soma dois saltos: navegador → Render → Pornhub.
- `/api/home` é tão lenta quanto a mais lenta das oito buscas.

## Alternativas consideradas

- **Front chamando a API direto** — barrado por CORS em produção; só funcionaria
  com o proxy do Vite, que não existe fora do `npm run dev`.
- **Função serverless na Vercel, junto do front** — resolveria o CORS sem
  serviço separado, mas a política de uso aceitável da Vercel é mais restritiva
  quanto a conteúdo adulto, e funções serverless não guardam cache em memória
  entre execuções: cada chamada iria até a API externa.
- **Proxy puro, repassando a resposta sem converter** — simples, mas jogaria a
  conversão de volta ao front e devolveria oito respostas grandes em vez de uma
  enxuta.
- **Copiar o catálogo para um banco, atualizado por rotina** — daria controle e
  velocidade, mas significa armazenar metadados de terceiros, exatamente o que
  [ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md) recusa.

## Referências

- `src/app.js`, `src/routes/index.js`
- `src/services/videosService.js` → `getHome`
- `src/config/homeSections.js` (as oito buscas da Home)
- `README.md` → seção "Endpoints"
