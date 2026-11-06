# ADR-0019 — Idade por autodeclaração, no mesmo clique do aceite

- **Status:** aceita
- **Data:** 2026-11-05
- **Substitui em parte:** [ADR-0015](0015-verificacao-de-idade-no-servidor.md)
  (provedor externo de verificação de idade)

## Contexto

A [ADR-0015](0015-verificacao-de-idade-no-servidor.md) resolveu a idade com um
**provedor externo**: a pessoa era levada ao serviço dele, mostrava documento ou
rosto lá, e nós recebíamos o veredito por webhook. A estrutura ficou pronta e
nunca foi ligada — depende de contrato assinado com um provedor, e sem ele
`/api/age/session` devolvia 503 e **ninguém entrava no site**.

O responsável pelo projeto decidiu que a idade será **declarada pela própria
pessoa**: um aviso de conteúdo adulto e uma confirmação, sem documento e sem
foto. Esta ADR registra a decisão, o que ela custa e o que sobra de proteção.

## Decisão

**A pessoa declara ser maior de 18 anos, e a declaração fica registrada.**

- **Um ato, uma tela, um clique.** A caixa de seleção diz as duas coisas —
  "declaro que tenho 18 anos ou mais" e "aceito os Termos e a Política de
  Privacidade" —, e `POST /api/auth/accept` grava as duas **na mesma
  transação**. Não existe estado em que uma passou e a outra não.
- **O que fica guardado:** `age_verified_at` (quando), `age_method`
  (`'autodeclaracao'`) e `age_declared_ip` (de onde). Numa declaração, a data e
  o IP **são** toda a evidência que existe — não haveria sentido em não
  guardá-los.
- **O que não existe:** nenhuma coluna de documento, foto, CPF ou data de
  nascimento, em nenhuma tabela. Não é "ainda não": é a decisão. Um teste em
  `authService.test.js` falha se alguém acrescentar um campo com esse nome.
- **As barreiras continuam no servidor.** `requireAdult` (403 `AGE_REQUIRED`) e
  `requireTerms` (403 `TERMS_REQUIRED`) seguem valendo em toda rota de catálogo,
  na mesma ordem: sessão → idade → termos → catálogo. O que mudou é **como** a
  idade passa a constar, não **onde** ela é exigida.
- **Idempotente.** Declarar de novo não reescreve data nem IP
  (`WHERE age_verified_at IS NULL`): a declaração que vale é a primeira, porque
  é a que a pessoa fez. Versão nova dos documentos exige aceite novo e **não**
  pede declaração outra vez.
- **O provedor saiu do código.** `ageService.js`, `routes/age.js`, o webhook
  assinado, as quatro variáveis `AGE_*` e os testes deles foram **removidos**.
  Um teste novo confirma que `/api/age/*` responde 404: adaptador morto que
  continua aceitando requisição é pior do que adaptador nenhum. O histórico está
  no Git e na ADR-0015.

## Consequências

**Positivas**

- O site passa a funcionar sem contrato com terceiro. Antes, sem provedor
  cadastrado, ninguém entrava.
- **Nenhum documento de identidade existe neste sistema.** O maior risco de
  dados do projeto — guardar documento junto de consumo pornográfico — deixou de
  existir, porque o dado não entra.
- Uma tela e um clique em vez de duas telas e um desvio para o site de um
  terceiro.
- O que a pessoa declarou, quando e de onde fica registrado e auditável.
- Menos código, menos dependência, menos segredo para cadastrar: saíram um
  serviço, um arquivo de rotas, quatro variáveis de ambiente e um webhook
  assinado.

**Negativas / custos aceitos — e são grandes**

- **Autodeclaração não verifica nada.** Qualquer menor de idade entra marcando
  uma caixa. É a consequência central desta decisão, e não há implementação que
  a contorne: só um terceiro conferindo documento ou rosto verificaria idade de
  verdade.
- **Os textos legais tiveram de mudar de conteúdo.** Os Termos diziam, com
  razão, que "não aceitamos declaração de idade por caixa de seleção: marcar
  'sou maior de idade' não verifica nada". Isso virou mentira na tela no momento
  em que esta decisão foi tomada, e foi corrigido no mesmo commit — a página
  agora descreve a declaração, a responsabilidade de quem declara e o que é
  guardado.
- **Exposição regulatória.** Legislação que exija verificação de idade por meio
  idôneo para conteúdo adulto (é a direção dos projetos em tramitação no Brasil
  e de regras já em vigor em outros países) não é atendida por autodeclaração.
  Se isso virar obrigação, a ADR-0015 volta a ser o caminho — e é por isso que
  ela **não foi apagada**, e que `age_method` continua existindo: uma conta
  liberada por declaração e outra por provedor podem conviver na mesma tabela.
- **Guardamos um IP a mais.** Pequeno, mas é dado pessoal, e existe só porque a
  declaração precisa de alguma evidência.
- A proteção efetiva do site passa a ser: aviso claro, declaração registrada,
  catálogo fechado por sessão, nenhuma miniatura antes da porta, e denúncia que
  remove na hora (ADR-0017). É menos do que a ADR-0015 prometia, e é o que
  existe.

## Alternativas consideradas

- **Manter o provedor externo (ADR-0015)** — a única forma de realmente
  verificar idade, e trava o site até haver contrato assinado e pago. Foi
  descartada por decisão do responsável.
- **Provedor opcional, declaração como alternativa** — pareceria o melhor dos
  dois mundos, e seria o pior: quem quisesse entrar escolheria sempre a
  declaração, e o provedor existiria só para o relatório.
- **Pedir a data de nascimento e calcular a idade** — parece mais sério e
  continua sendo autodeclaração, com o agravante de guardar data de nascimento,
  que é dado pessoal de verdade. Caixa de seleção protege menos dados e engana
  menos.
- **Declaração só no navegador (cookie ou `localStorage`)** — é o padrão da
  maioria dos sites adultos, e não deixa registro nenhum: não haveria como dizer
  depois o que a pessoa declarou, nem quando. O servidor segue decidindo.
- **Duas telas, uma para idade e outra para termos** — separa dois atos que, do
  jeito como ficaram, são o mesmo clique; serviria só para a pessoa clicar duas
  vezes sem ler nenhuma das duas.

## Referências

- `src/services/usersService.js` (`declareAdult`,
  `declareAdultAndAcceptTerms`), `src/services/authService.js` (`acceptGate`),
  `src/routes/auth.js` (`POST /accept`), `src/http/requireAdult.js`,
  `src/db/schema.sql`
- `test/authService.test.js` (a declaração e a ausência de campo de documento),
  `test/routes.test.js` (o clique único, a idempotência e o 404 das rotas do
  provedor)
- [ADR-0015](0015-verificacao-de-idade-no-servidor.md) — o que foi substituído,
  e o caminho de volta se a lei exigir
- [ADR-0016](0016-aceite-de-termos-por-versao.md) — o aceite por versão, que
  passou a andar junto da declaração
