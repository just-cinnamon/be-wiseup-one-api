# ADR-0014 — O captcha é exigido só quando há secret para conferi-lo

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 0 do plano de prevenção
- **Limita:** [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md), na parte do
  captcha

## Contexto

A ADR-0011 fez duas coisas com o captcha, e as duas pelo motivo certo:

1. `parseCredentials` **exige** `captchaToken` no corpo do login;
2. sem `RECAPTCHA_SECRET`, o `captchaService` **recusa tudo em produção** — para
   um deploy sem a variável cadastrada barrar o login, em vez de liberá-lo.

Depois disso, o front **removeu o widget do reCAPTCHA** (a ADR-0014 dele voltou
a `proposta`: o widget volta junto com a verificação no servidor). O resultado
é que as duas regras acima, juntas, trancam a porta inteira: o front não manda
`captchaToken`, então todo login morre em `400 INVALID_PARAMS` antes de chegar
ao banco — e, com secret cadastrado, morreria em `CAPTCHA_FAILED` de todo jeito.

E isso não é uma inconveniência passageira. A [ADR-0012](0012-catalogo-exige-sessao.md)
acabou de fechar o catálogo: **sem login não existe mais nada**. Um front sem
captcha com um back exigindo captcha é um site inacessível.

## Decisão

**A exigência do token acompanha a existência do secret.**

`createAuthService` passou a receber `captchaRequired`, que o `server.js`
calcula como `Boolean(env.recaptchaSecret)`:

- **Com `RECAPTCHA_SECRET`:** nada muda. O token é obrigatório e conferido no
  `siteverify`, antes da senha, como a ADR-0011 definiu.
- **Sem `RECAPTCHA_SECRET`:** o token não é exigido nem consultado, e o boot
  **avisa em voz alta** que a única barreira contra força bruta passou a ser o
  bloqueio por conta (5 tentativas, 15 minutos).

O limite de tamanho do campo (4000 bytes) vale nos dois casos: campo grande no
corpo é entrada hostil independentemente do captcha.

Ligar o captcha de volta é cadastrar a variável. Não há código a mudar, nos dois
repositórios — no front, só o widget.

## Consequências

**Positivas**

- O site funciona com ou sem captcha, e **o modo está sempre declarado**: o log
  de boot diz qual dos dois está no ar.
- Não existe mais o estado "exige um token que ninguém verifica", que era teatro
  de segurança com aparência de rigor.
- A volta do captcha é uma variável de ambiente, não um deploy coordenado.

**Negativas / custos aceitos**

- **A postura "sem secret, recusa tudo" caiu.** Era a mais segura em abstrato, e
  deixou de ser defensável quando passou a significar "ninguém entra".
- **Força bruta fica por conta do bloqueio por conta.** Isso segura ataque
  contra uma senha, e **não segura *credential stuffing*** — uma tentativa em
  cada uma de mil contas, em que nenhuma chega ao limite. Está aceito como
  temporário, e é o argumento para o captcha voltar.
- Quem subir sem o secret e não ler o log vai achar que tem captcha.

## Alternativas consideradas

- **Reimplementar o widget no front agora** — resolve de verdade, e depende de
  registrar o site no painel do Google (Etapa 0 do plano de autenticação do
  front), que é tarefa manual e ainda não foi feita.
- **Variável separada, `CAPTCHA_REQUIRED=true|false`** — mais explícita, e
  permite o estado incoerente "exigido, sem secret para conferir", que é
  justamente o que esta ADR tira do caminho.
- **Aceitar qualquer token quando não há secret** — mantinha a validação de
  formato e dava a impressão de proteção. Mentira na API é a mesma mentira que a
  frase do rodapé do front, removida pelo mesmo motivo.
- **Rate limit por IP no lugar do captcha** — ajuda e não substitui: o Render
  entrega todo mundo atrás do proxy, e um atacante com IPs rotativos passa. Fica
  como candidato para a Fase 4.

## Referências

- `src/services/authService.js` (`captchaRequired`), `src/server.js` (o aviso de
  boot), `src/services/captchaService.js` (inalterado)
- `test/authService.test.js` → "sem RECAPTCHA_SECRET o login não pede captcha, e
  nem o consulta"
- [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md) — a exigência original
- [ADR-0012](0012-catalogo-exige-sessao.md) — por que um login travado agora
  significa um site inacessível
