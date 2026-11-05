# ADR-0010 — Deploy no Render, em região fora dos Estados Unidos

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O front vai para a Vercel
([ADR-0010 do front](https://github.com/just-cinnamon/be-wiseup-one/blob/main/docs/adr/0010-deploy-na-vercel-com-rewrite-spa.md)),
mas a Vercel não serve para este back-end: o cache em memória
([ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md)) depende de um processo
que fica de pé entre requisições, e função serverless não oferece isso.

Dois fatores pesam na escolha, e nenhum é técnico:

1. **Política do provedor.** A política de uso aceitável do Render não proíbe
   conteúdo adulto pelo nome, mas tem cláusula genérica sobre conteúdo
   "objetável", a critério dele. A da Vercel é mais restritiva. O back-end só
   entrega JSON, mas é parte de um sistema que exibe conteúdo adulto: suspensão
   de conta é risco real.
2. **Bloqueio por região.** O Pornhub bloqueia acesso em vários estados dos EUA
   por causa de leis de verificação de idade, e o bloqueio vale para o **IP do
   servidor**, não de quem acessa. Um back-end hospedado na região errada recebe
   erro na chamada de saída e devolve 502 em tudo.

## Decisão

Publicar no **Render**, como Web Service no plano gratuito, em região **fora dos
Estados Unidos** (Frankfurt como primeira escolha).

Configuração:

| Campo | Valor |
| --- | --- |
| Region | Frankfurt (alternativa: Oregon) |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Auto-Deploy | On Commit (`main`) |

Variáveis de ambiente: `NODE_VERSION=22` (obrigatória — `--env-file-if-exists`
exige 22.9+) e `CORS_ORIGINS` com a URL do front publicado. `PORT` **não** se
cadastra: o Render define, e `src/config/env.js` lê de `process.env.PORT`.

Teste obrigatório logo após o deploy: `/api/health` **e** `/api/categories`.
`health` respondendo com `categories` em 502 significa bloqueio da API externa
na região — a solução é trocar a região, não mexer no código.

## Consequências

**Positivas**

- Processo de pé, então o cache em memória funciona como projetado e é
  compartilhado por todo mundo.
- `npm install` + `npm start`, sem build: o que roda em produção é o que está no
  repositório ([ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md)).
- Deploy a cada push na `main`, sem pipeline para manter.
- `/api/health` dá ao Render um jeito de saber se o serviço está vivo, e serve
  para verificar o deploy sem tocar na API externa.
- Front e back-end em contas separadas: se um provedor suspender, o outro não cai
  junto.

**Negativas / custos aceitos**

- **O serviço dorme em ~15 min de inatividade.** A primeira chamada depois disso
  leva cerca de **um minuto**. É o custo que mais aparece para quem usa, e por
  isso o cliente do front usa timeout de 70s.
- Ao dormir, o cache é apagado: a primeira visita do dia paga as oito buscas da
  Home.
- A região escolhida por causa do bloqueio é longe do Brasil: a latência
  Brasil → Frankfurt → Pornhub soma a cada chamada não cacheada.
- **O risco de suspensão continua**, só é menor que na Vercel. A cláusula de
  conteúdo "objetável" é discricionária.
- Se o Pornhub estender o bloqueio à Europa, a solução é trocar de região de
  novo — fora do nosso controle.
- `CORS_ORIGINS` precisa ser editada à mão quando o front muda de URL, e salvar
  reinicia o serviço (zerando o cache).

## Alternativas consideradas

- **Vercel, junto do front** — um provedor só e sem dormir, mas política mais
  restritiva quanto a conteúdo adulto e função serverless sem cache em memória,
  fazendo cada chamada ir até a API externa.
- **Região nos EUA** — mais perto do Brasil em latência, mas é justamente onde o
  bloqueio por lei estadual acontece. Oregon fica como reserva porque não está
  entre os estados que bloqueiam, mas é aposta sobre lei que pode mudar.
- **Plano pago do Render (~US$7/mês)** — acaba com o sono e com o cache zerado.
  A escolha certa se o projeto sair de estudo; não se justifica agora.
- **Fly.io ou Railway** — tecnicamente parecidos; o Render foi escolhido pela
  configuração mais simples e por aceitar login do GitHub já usado no projeto.
- **Rodar só local** — elimina risco de suspensão e de política de provedor, e é
  a recomendação se o objetivo for apenas estudo. Mas o front publicado precisa
  de um back-end publicado para funcionar fora do micro.
- **Manter acordado com ping periódico** — resolveria o sono de graça, mas é
  contornar a limitação do plano gratuito, ou seja, usar o serviço de um jeito
  que ele não pretende oferecer.

## Referências

- `src/config/env.js` (`PORT`, `CORS_ORIGINS`)
- `src/routes/index.js` → `/health`
- `package.json` → `start`, `engines`
- `README.md` → seção "Deploy"
- Guia de origem, seção 10
