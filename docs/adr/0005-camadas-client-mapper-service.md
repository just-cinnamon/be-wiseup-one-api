# ADR-0005 — Camadas client / mapper / service, com as regras fora do Express

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O caminho natural num projeto pequeno de Express é escrever tudo na rota:
`fetch`, validação, conversão e resposta. Com quatro rotas isso até caberia.

Mas três coisas deste back-end mudam em ritmos diferentes:

- **a API externa** — formato indocumentado, que já divergiu do esperado
  (`rating` veio número e não texto, `video_id` virou hash em vez de `ph...`,
  `thumbsize=large_hd` passou a ser ignorado);
- **o contrato do front** (`Title`), que o front controla;
- **as regras dos endpoints** (quais valores de `ordering` valem, como a Home é
  montada), que são deste repositório.

Além disso, não há TypeScript ([ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md)):
os testes são a única rede de proteção. E testar via HTTP exige subir servidor,
escolher porta e bater em rede — lento e instável.

## Decisão

Separar em quatro camadas, cada uma recebendo suas dependências por parâmetro
(injeção de dependência), e manter **Express só na borda**.

```
GET /api/videos?q=...
  → src/routes/index.js        rota HTTP (só Express)
  → src/services/videosService.js   valida parâmetros e monta a resposta
  → src/services/pornhubClient.js   chama a API externa, com cache
  → src/mappers/videoMapper.js      converte para Title
  ← JSON para o front
```

Regras que a separação impõe:

- **só** `pornhubClient.js` fala com a API externa, e recebe `fetchFn` por
  parâmetro (nos testes, uma função falsa; em produção, o `fetch` global);
- **só** `videoMapper.js` conhece os nomes dos campos da API externa
  (`video_id`, `publish_date`, `default_thumb`), e é composto de funções puras —
  até o "agora" entra por parâmetro (`{ now }`), para que `isNew` seja testável;
- `videosService.js` não importa Express: recebe `{ client }` e trabalha com
  objetos simples. É aqui que ficam as listas de valores permitidos e a montagem
  da Home;
- `createApp()` monta o Express mas **não** chama `listen`; só `server.js` sobe
  o servidor, lendo as variáveis de ambiente;
- as fileiras da Home são dados, não código: `src/config/homeSections.js`.

## Consequências

**Positivas**

- Os 19 testes rodam em ~90ms, sem rede e sem porta: `videosService` roda com um
  cliente falso (`test/helpers.js`), e o cliente roda com um `fetchFn` falso.
- O cache pôde ser testado com relógio falso (`now: () => clock`), inclusive a
  devolução da resposta expirada, sem `setTimeout` em teste.
- Quando a API externa muda um campo, **um** arquivo muda. Foi o que aconteceu
  com `publish_date` e com os slugs de categoria, e nada mais precisou saber.
- `createApp()` sem `listen` deixa a porta de entrada aberta para testes de HTTP
  de ponta a ponta no futuro, sem refatorar.
- Trocar a fonte de dados é escrever outro cliente com os mesmos três métodos
  (`search`, `videoById`, `categories`).

**Negativas / custos aceitos**

- Mais arquivos e mais indireção do que o tamanho do projeto exigiria: ler uma
  requisição inteira passa por quatro arquivos.
- Funções-fábrica (`createX({ ... })`) em vez de `import` direto: mais cerimônia
  na montagem, concentrada em `server.js`.
- O cliente falso dos testes pode divergir do cliente real sem ninguém notar —
  não há teste que suba o Express de verdade, então erro de fiação
  (`createApp` montado errado) só aparece ao rodar.
- As camadas não impedem atalho: nada além de revisão evita um `fetch` dentro da
  rota.

## Alternativas consideradas

- **Tudo nas rotas** — menos arquivos, mas as regras ficariam presas a `req`/`res`
  e os testes teriam que subir servidor HTTP.
- **Camadas sem injeção de dependência** (`import` direto do cliente nos
  serviços) — mais simples de ler, mas exigiria mexer no carregador de módulos
  para testar, justamente o que o `node:test` não facilita.
- **Converter já no cliente**, devolvendo `Title` pronto — juntaria "falar HTTP"
  com "conhecer o formato do front" na mesma peça, e o cache passaria a guardar
  dado já convertido, perdendo a resposta original.
- **Arquitetura hexagonal com portas e adaptadores explícitos** — o mesmo
  princípio, com muito mais cerimônia do que quatro rotas justificam.

## Referências

- `src/routes/index.js`, `src/app.js`, `src/server.js`
- `src/services/videosService.js`, `src/services/pornhubClient.js`
- `src/mappers/videoMapper.js`, `src/config/homeSections.js`
- `test/helpers.js` (cliente falso), `test/client.test.js` (relógio e `fetch` falsos)
- `README.md` → seção "Estrutura"
