# ADR-0016 — Aceite de termos gravado por versão, e exigido a cada requisição

- **Status:** aceita (o mecanismo está no ar; os **textos** são rascunho e
  precisam de revisão jurídica — ver "O que falta")
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 2 do plano de prevenção

## Contexto

O site não tinha Termos de Uso nem Política de Privacidade — e passou a ter
coisas que exigem os dois: conta com e-mail e senha
([ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md)), verificação de idade
por terceiro ([ADR-0015](0015-verificacao-de-idade-no-servidor.md)) e, a
seguir, denúncia de conteúdo.

"Ter os textos publicados" é metade. A outra metade é **poder provar o que cada
pessoa aceitou**: um link no rodapé que aponta para a versão de hoje não diz
nada sobre o que estava escrito quando a conta foi criada.

## Decisão

**Uma linha por aceite, com documento, versão e data, e nada é apagado.**

```sql
CREATE TABLE terms_acceptances (
  user_id, document, version, accepted_at,
  PRIMARY KEY (user_id, document, version)
);
```

- **A versão vigente é constante no código** (`src/config/legal.js`), não linha
  no banco: ela anda junto com o texto, que também está no repositório (no
  front). Mudar a data ali **obriga todo mundo a aceitar de novo**.
- `requireTerms` roda depois de `requireAuth` e `requireAdult`, e devolve
  `403 TERMS_REQUIRED`. A ordem em `routes/index.js` continua sendo a regra de
  acesso: **sessão, idade, termos, catálogo**.
- **Os dois documentos são obrigatórios.** `termsAccepted` é "aceitou os dois
  na versão vigente"; um só não abre nada.
- `POST /api/auth/accept-terms` grava os dois de uma vez. **Não há corpo a
  validar**: não existe opção a escolher, e a caixa de seleção que a pessoa
  marcou está na tela do front, que é onde ela tem sentido. A rota exige sessão
  e **não** exige termos aceitos — seria o cadeado trancando a chave dentro,
  como em `/api/age`.
- **Idempotente** (`ON CONFLICT DO NOTHING`): aceitar duas vezes a mesma versão
  não duplica linha nem reescreve a data. A data que vale é a do primeiro
  aceite.
- A contagem de aceites **viaja na mesma consulta da sessão**, como subconsulta
  com as versões vigentes por parâmetro. Era isso ou uma terceira ida ao banco
  em cada requisição autenticada.
- `GET /api/auth/me` passou a devolver `legalVersions`, para o front saber qual
  versão está sendo exigida.

## Consequências

**Positivas**

- Dá para responder, por conta, **o que foi aceito e quando** — inclusive de
  versões que já saíram de circulação.
- Publicar texto novo é mudar uma data: ninguém é deslogado, e ninguém chega ao
  catálogo sem aceitar.
- O aceite é verificado no servidor a cada requisição, não guardado no
  navegador.
- `ON DELETE CASCADE` faz o aceite ir junto com a conta excluída, mantendo o
  direito de exclusão da LGPD coerente.

**Negativas / custos aceitos**

- **Apagar a conta apaga a prova do aceite.** É a escolha certa para a LGPD e
  deixa o histórico incompleto de propósito.
- **Versão nova trava quem não aceitar**, inclusive quem só queria assistir.
  É o preço de o aceite significar algo.
- Mudar `legal.js` sem mudar o texto, ou o contrário, cria incoerência que
  nenhum teste pega: **a versão é disciplina, não validação**.
- O aceite registra a conta, não a pessoa: prova que alguém com aquela senha
  clicou.
- Nada verifica se o texto foi **lido**, e nenhuma implementação consegue.

## O que falta (fora do código)

1. **Revisão jurídica dos dois textos.** O que está publicado é rascunho
   escrito contra a tabela de itens obrigatórios do plano de prevenção, e está
   marcado como tal **na própria página**. Não pode ir ao ar como definitivo.
2. Preencher o que o rascunho deixou em aberto: razão social ou nome do
   responsável, contato de denúncia e contato do encarregado de dados.
3. Depois da revisão, atualizar a data em `legal.js` **uma vez** — e a partir
   daí tratar cada mudança como versão.

## Alternativas consideradas

- **Só publicar as páginas, sem registrar aceite** — é o padrão de muito site
  pequeno, e não prova nada. Com conta, idade verificada e denúncia no mesmo
  produto, "não dá para saber o que você aceitou" é resposta ruim.
- **Guardar um booleano `terms_ok` em `users`** — uma coluna, zero histórico:
  na primeira versão nova, a informação anterior desaparece.
- **Guardar o texto inteiro aceito, por conta** — prova perfeita e banco
  inflado com milhares de cópias do mesmo documento. A versão + o texto no Git
  dão o mesmo resultado.
- **Aceite implícito ao criar a conta** ("ao entrar, você concorda") — não há
  cadastro neste projeto, e aceite implícito é justamente o que o registro por
  versão existe para evitar.
- **Versão no banco, editável por rota de administração** — flexível e permite
  mudar o que é exigido sem deploy, inclusive por engano.

## Referências

- `src/config/legal.js`, `src/http/requireTerms.js`,
  `src/routes/auth.js` (`/accept-terms`), `src/db/schema.sql`
- `test/routes.test.js` (o 403, o aceite e a ordem das barreiras),
  `test/authService.test.js` (aceite por versão), `test/usersService.test.js`
  (o SQL, com `TEST_DATABASE_URL`)
- [ADR-0015](0015-verificacao-de-idade-no-servidor.md) — a barreira anterior na
  mesma fila
- As páginas `/termos` e `/privacidade` ficam no repositório do front
