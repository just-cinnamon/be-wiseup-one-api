# ADR-0013 — Postgres gerenciado no lugar do `node:sqlite`

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 0 do plano de prevenção
- **Limita:** [ADR-0003](0003-node-22-express-5-minimo-de-dependencias.md) (mínimo
  de dependências) e substitui a parte de armazenamento da
  [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md)

## Contexto

A [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md) escolheu `node:sqlite`
por uma razão boa: banco embutido, zero dependência nova, e a ADR-0003 intacta.
O custo estava escrito lá e no `.env.example`: **no plano gratuito do Render o
disco é efêmero**, então o arquivo do banco morre a cada deploy e a cada
hibernação. A saída era semear as contas no boot.

Semear funciona para conta de demonstração. **Não funciona para nada do plano de
prevenção.** As Fases 2 e 3 vão gravar aceite de termos (com versão e data),
denúncia recebida e vídeo bloqueado — e esses registros são exatamente a prova
de boa-fé que o site precisaria mostrar caso alguém questione. Um deploy
apagando a tabela de denúncias é pior que não ter a tabela: dá a aparência de
controle sem o controle.

O mesmo vale para a verificação de idade da Fase 1: perder `age_verified_at`
significa pedir verificação de novo a cada deploy — ou, se o front guardasse
isso, significa não ter verificação nenhuma.

## Decisão

**Postgres gerenciado, acessado com a dependência `pg`.**

- `src/db/database.js` virou `createDatabase({ connectionString, sslInsecure })`
  e devolve `{ query, applySchema, close }`. Continua sendo **o único arquivo
  que conhece o driver**: o `usersService` só vê `query` (ADR-0005).
- `DATABASE_FILE` saiu; entrou `DATABASE_URL`. Serve Neon, Supabase ou o
  Postgres do próprio Render, todos com plano gratuito.
- TLS é exigido por padrão para host remoto e dispensado para `localhost`.
  `DATABASE_SSL_INSECURE=true` existe para provedor com certificado próprio, e
  vem desligado: relaxar TLS tem de ser escolha explícita.
- **Todo o `usersService` é assíncrono** agora, e com ele `authService.login`,
  `getSessionUser`, `logout`, `deleteAccount` e o `requireAuth`. O driver é
  assíncrono; o `DatabaseSync` não era.
- As colunas de data continuam `TEXT` com ISO 8601 em UTC, e não `TIMESTAMPTZ`:
  o código compara datas como string (`expires_at <= nowIso`), e ISO 8601 em UTC
  ordena igual como texto e como data. Com `TIMESTAMPTZ` o driver devolveria
  `Date` e a comparação mudaria de forma em todo o serviço, sem ganho aqui.
- `--experimental-sqlite` saiu dos scripts do `package.json`.

### O que isso faz com os testes

`node:sqlite` dava banco em memória de graça, e `test/authService.test.js` usava
um. Postgres não tem equivalente embutido, e exigir um servidor de pé para
`npm test` seria pior que o problema que estamos resolvendo. Então:

- **Regras** (bloqueio por tentativas, ordem do login, validade de sessão,
  cascata) seguem testadas sempre, com um `users` falso em memória declarado em
  `test/helpers.js` — o `authService` já recebia `users` por parâmetro
  (ADR-0005), então não foi preciso adaptar nada do código para testar.
- **SQL** ganhou `test/usersService.test.js`, que roda **só** quando existe
  `TEST_DATABASE_URL` e é pulado sem ela. Cobre o `UNIQUE` de e-mail, o
  `ON DELETE CASCADE`, a faxina de sessões vencidas e o ida-e-volta das datas.

## Consequências

**Positivas**

- Aceite de termos, denúncia e bloqueio de vídeo sobrevivem a deploy, que é a
  condição para as Fases 1 a 3 valerem algo.
- Conta criada em produção para de se perder.
- O banco deixa de ser arquivo numa instância: o dia em que houver duas
  instâncias, isso já funciona.
- `ON DELETE CASCADE` passa a valer sem `PRAGMA`: no SQLite era preciso ligar a
  chave estrangeira a cada conexão, e esquecer disso silenciosamente não
  apagava as sessões.

**Negativas / custos aceitos**

- **Uma dependência nova** (`pg`, com 2 pacotes transitivos), contra a ADR-0003.
  É o preço de ter durabilidade, e está pago com consciência: o critério da
  ADR-0003 era "nada que a plataforma já resolva", e esta a plataforma não
  resolve.
- **Mais um serviço externo de pé.** Banco fora do ar agora significa login
  fora do ar; antes significava só perder as contas.
- **Latência de rede** em cada consulta, onde antes era leitura de arquivo
  local. Irrelevante no volume deste projeto, e o catálogo não passa por aqui.
- **Em desenvolvimento é preciso um Postgres.** Sem `DATABASE_URL` o processo
  não sobe — de propósito, porque subir sem banco só adiaria o erro.
- O plano gratuito de alguns provedores **hiberna** o banco: a primeira consulta
  depois de um tempo parado é lenta, somando ao Render que já hiberna.

## Risco conhecido, registrado de propósito

**O SQL novo não foi executado contra um Postgres de verdade.** A máquina onde
esta migração foi escrita não tem Postgres, Docker nem `psql`, então
`test/usersService.test.js` foi escrito e **pulado**. O primeiro boot com
`DATABASE_URL` real é parte da entrega, não um detalhe: rode
`TEST_DATABASE_URL=... npm test` antes de confiar nesta camada.

## Alternativas consideradas

- **Disco persistente pago do Render** (~US$ 7/mês) — mantinha `node:sqlite` e a
  ADR-0003 intactos, com uma linha de configuração. Perde em não resolver a
  segunda instância e em amarrar o banco ao provedor; e o plano gratuito do
  Postgres gerenciado custa zero.
- **Continuar semeando e aceitar a perda** — é o que havia, e é insustentável a
  partir da Fase 2: perder aceites de termos é perder a prova de que existiram.
- **SQLite num serviço de volume externo** (Litestream, Turso) — resolve, e
  troca uma dependência por uma infraestrutura inteira a mais para entender.

## Referências

- `src/db/database.js`, `src/db/schema.sql`, `src/services/usersService.js`
- `test/usersService.test.js` (SQL, com `TEST_DATABASE_URL`),
  `test/helpers.js` → `fakeUsers()` (regras, sempre)
- [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md) — a escolha que esta
  substitui na parte de armazenamento
- [ADR-0012](0012-catalogo-exige-sessao.md) — a proteção que depende desta
  sessão existir de verdade
