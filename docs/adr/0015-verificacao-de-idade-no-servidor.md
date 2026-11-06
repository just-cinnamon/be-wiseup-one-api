# ADR-0015 — Verificação de idade decidida no servidor, com provedor externo

- **Status:** **parcialmente substituída** pela
  [ADR-0019](0019-idade-por-autodeclaracao.md) — a idade passou a ser
  **declarada pela própria pessoa**, e o provedor externo descrito aqui
  (`ageService.js`, `/api/age/*`, webhook assinado e as variáveis `AGE_*`) foi
  **removido do código**. Continua valendo o que esta ADR decidiu sobre
  **onde** a idade é exigida: no servidor, por `requireAdult`, em toda rota de
  catálogo, com campo ausente significando "não". O raciocínio sobre o
  provedor fica registrado para o caso de a lei passar a exigir verificação de
  verdade — é para cá que se volta
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 1 do plano de prevenção

## Contexto

O acervo é adulto. Até aqui, a única barreira era o login, e o login não
pergunta idade: qualquer conta semeada via `curl` recebia o catálogo inteiro.
A [ADR-0012](0012-catalogo-exige-sessao.md) fechou o catálogo para quem não tem
sessão; esta fecha para quem tem sessão e não comprovou idade.

Duas restrições moldaram o desenho:

1. **Quem decide tem de ser o servidor.** "Clique aqui se você tem 18 anos" é
   enfeite, e um sinalizador no front é um `localStorage` que qualquer pessoa
   edita. A decisão precisa morar no banco e ser conferida a cada requisição.
2. **Não podemos guardar o que comprova a idade.** Documento, foto, CPF e data
   de nascimento são dado sensível, e guardá-los criaria um risco maior do que
   o que estamos resolvendo. Quem faz a verificação é um provedor especializado;
   nós guardamos o veredito.

## Decisão

**Provedor externo faz a verificação; o back-end guarda só o resultado e barra
o catálogo com um middleware.**

### No banco

Três colunas em `users`, e nada mais:

```sql
age_verified_at TEXT   -- ISO 8601, ou NULL
age_method      TEXT   -- 'facial' | 'documento' | 'banco'
age_ref         TEXT   -- identificador da verificação no provedor
```

`age_ref` sem `age_verified_at` é uma verificação **em andamento**, e é o que
distingue "nunca tentou" de "está esperando o provedor". É também a chave que
casa o webhook com a conta, sem o provedor precisar saber quem é a pessoa.

### No fluxo

```
POST /api/age/session   (com sessão)  → cria no provedor, grava age_ref, devolve url
       ↓ pessoa verifica na tela do provedor
POST /api/age/webhook   (assinado)    → confere HMAC, grava age_verified_at
GET  /api/age/status    (com sessão)  → { ageVerified, pending, method, verifiedAt }
```

- **`requireAdult`** roda depois do `requireAuth` e devolve `403 AGE_REQUIRED`.
  A ordem em `routes/index.js` é a regra: sessão, idade, catálogo. Campo
  ausente ou nulo é "não verificado" — um dado que falta nunca libera acesso.
- **As rotas de `/api/age` ficam fora do `requireAdult`**: exigir idade
  verificada para poder verificar a idade seria o cadeado trancando a chave
  dentro. `/session` e `/status` exigem sessão; o webhook não pode, porque quem
  chama é o provedor.
- **O webhook é autenticado por assinatura**, HMAC-SHA256 do **corpo cru** com
  `AGE_WEBHOOK_SECRET`, comparado em tempo constante. O corpo cru é capturado
  no `express.json` com `verify`, porque `JSON.stringify(req.body)` não
  reproduz byte a byte o que foi assinado. Sem segredo cadastrado, nenhuma
  assinatura é aceita: um webhook sem conferência é um endpoint para qualquer
  pessoa liberar o próprio acesso.
- **`ageService.js` é o único arquivo que fala com o provedor**, e recebe
  `fetchFn` por parâmetro (ADR-0005). Trocar Yoti por Unico ou Idwall para
  aqui: o formato do corpo está isolado em `buildSessionBody` e `parseWebhook`.
- **`ageVerified` viaja na sessão**, montado em `getSessionUser` a partir do
  `JOIN` que já era feito. O `requireAdult` decide sem consulta extra.
- Provedor fora do ar, lento, mal configurado ou com resposta estranha vira
  `503 AGE_PROVIDER_UNAVAILABLE`. **Nenhum caminho de falha libera acesso.**

### A exceção, declarada

`AGE_DEV_AUTOVERIFY=true` marca qualquer conta como verificada sem provedor
nenhum. Existe porque o front precisa ser desenvolvível antes de haver contrato
assinado, e é a única porta de serviço deste desenho. Por isso:

- é **ignorada quando `NODE_ENV=production`**, e a checagem é feita uma vez, na
  construção do serviço, não a cada chamada;
- o boot **grita** no log quando ela está ligada;
- há teste garantindo que em produção ela volta a recusar com 503.

## Consequências

**Positivas**

- Conta nova não vê miniatura, título nem embed antes de verificar: o 403 vem
  antes do `videosService`.
- O banco não guarda nenhum dado sensível novo — só "quando, como e o ID no
  provedor".
- A decisão é por requisição, no servidor: não há estado no front para burlar.
- Trocar de provedor é mexer em um arquivo.
- `/api/age/status` dá ao front como distinguir "verifique" de "estamos
  esperando o provedor", que é a diferença entre duas telas muito diferentes.

**Negativas / custos aceitos**

- **Um terceiro no caminho de entrar**, que recebe IP e dados do aparelho de
  quem verifica. Precisa ser declarado na política de privacidade (Fase 2) e
  contratado por escrito, com a finalidade limitada.
- **Custo por verificação.** Reabrir sessão é permitido (desistir no meio é
  comum), e cada reabertura é uma cobrança — mitigado por não criar sessão nova
  para quem já está verificado.
- **Provedor fora do ar fecha o site.** É a escolha certa, e é indisponibilidade
  real.
- Verificação de idade **não é identificação da pessoa**: ela diz que alguém
  adulto passou pela tela, não que seja o titular da conta.
- **A integração HTTP não foi exercitada contra provedor real.** O formato de
  `buildSessionBody`, do webhook e dos cabeçalhos de assinatura é o formato
  _esperado_, e vai precisar de ajuste quando o provedor estiver escolhido — os
  testes usam `fetch` falso.

## O que falta (fora do código)

1. Escolher o provedor e confirmar **por escrito** que ele não guarda os dados
   para outra finalidade.
2. Cadastrar `AGE_PROVIDER_URL`, `AGE_PROVIDER_KEY` e `AGE_WEBHOOK_SECRET`.
3. Conferir o formato real do corpo e do cabeçalho de assinatura, e ajustar
   `ageService.js` — é para isso que ele é um arquivo só.
4. Declarar o provedor como operador na Política de Privacidade (Fase 2).

## Alternativas consideradas

- **Caixa "tenho 18 anos"** — custo zero e proteção zero. É o que o Decreto
  12.880/2026 veio justamente tornar insuficiente.
- **Pedir data de nascimento no cadastro** — cria dado pessoal novo, é
  trivialmente mentira e não verifica nada.
- **Guardar o documento e conferir a olho** — vira guarda de dado sensível sem
  nenhuma das proteções que um provedor especializado tem, e com a nossa
  responsabilidade.
- **Verificação só no front, com o provedor conversando direto com o navegador**
  — o resultado chegaria por um caminho que a própria pessoa controla.
- **Estimativa de idade pelo próprio sistema** (comportamento, cartão) — não
  temos sinal nenhum para isso, e cartão exigiria meio de pagamento.

## Referências

- `src/services/ageService.js`, `src/http/requireAdult.js`, `src/routes/age.js`
- `src/db/schema.sql` (as três colunas), `src/services/usersService.js`
- `test/ageService.test.js` (adaptador), `test/routes.test.js` (o 403, o
  webhook e o atalho de desenvolvimento)
- [ADR-0012](0012-catalogo-exige-sessao.md) — a sessão que isto pressupõe
- [ADR-0013](0013-postgres-gerenciado-no-lugar-do-sqlite.md) — por que o
  `age_verified_at` sobrevive a um deploy
