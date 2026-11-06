# ADR-0018 — Teto para o cache expirado, e registro de acesso mínimo

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 do plano de prevenção

## Contexto

Duas pontas soltas, pelo mesmo motivo: o site passou a **tirar conteúdo do ar**
(ADR-0017) e a ser responsável por quem entra (ADR-0015).

1. **O cache servia para sempre.** Quando a origem falha, o cliente devolve a
   resposta expirada — "melhor dado antigo do que erro". Isso valia sem limite:
   com a origem fora do ar por um dia, o catálogo continuaria mostrando a foto
   de um dia atrás, que pode listar vídeo **já removido na origem** — e o motivo
   da remoção é justamente o que não pode continuar aqui.
2. **Não havia registro de acesso.** O Marco Civil da Internet (art. 15) obriga
   a guardar, por seis meses, registro de acesso à aplicação. Não havia nenhum.

## Decisão

### Teto de uma hora para o cache expirado

Cada entrada guarda `storedAt`, e `cache.get` passou a devolver `ageSeconds`.
Acima de `maxStaleSeconds` (uma hora), a entrada é **descartada** e o erro da
origem sobe: 502 ou 504, em vez de conteúdo que ninguém consegue conferir.

Uma hora é o ponto em que a resposta deixa de ser "antiga" e passa a ser
"inverificável": um catálogo de uma hora atrás ainda reflete a origem; de um dia
atrás, não necessariamente.

### Registro de acesso mínimo

`access_logs` tem **três colunas de conteúdo**: `user_id`, `ip`, `accessed_at`.

- **Gravado só no login**, nunca por requisição. Uma linha por login é registro
  de acesso; uma linha por requisição seria rastro de navegação, que é outra
  coisa e não é exigida por lei.
- **Não grava** o que foi buscado, que vídeo foi aberto, navegador, sistema nem
  impressão digital de aparelho. Nada disso é exigido, e tudo isso junto seria
  um histórico de consumo pornográfico por pessoa — o tipo de base que, vazando,
  faz dano irreparável. A ausência dessas colunas é a decisão, não uma etapa que
  ficou para depois.
- `record` **nunca lança**: falha no registro não pode impedir alguém de entrar
  na conta. O erro vai para o log do processo.
- Gravado **depois** da autenticação, para tentativa recusada não virar registro
  de acesso.
- **Faxina diária** apaga o que passou de 180 dias. Rodar isso é parte da
  obrigação: guardar além do prazo deixa de ser cumprimento de obrigação legal e
  passa a ser retenção sem base (LGPD, art. 16).
- `app.set('trust proxy', 1)` — um salto, o do provedor de hospedagem. Confiar
  na cadeia toda (`true`) deixaria qualquer cliente escrever o próprio
  `X-Forwarded-For` e escolher o IP que vai para o registro.

### `user_id` sem chave estrangeira

`access_logs.user_id` é `TEXT` puro, de propósito. O registro tem de sobreviver
aos seis meses da lei mesmo que a conta seja excluída. Com `REFERENCES`, haveria
só duas opções, e as duas erradas: `CASCADE` apagaria o registro antes do prazo,
e `SET NULL` o deixaria sem dizer quem acessou — inútil para a finalidade que
justifica guardá-lo.

A Política de Privacidade diz isso em voz alta: o registro de acesso é a única
coisa que sobrevive à exclusão da conta, e sobrevive porque guardá-lo é
obrigação legal, não escolha nossa.

## Consequências

**Positivas**

- Origem fora do ar por muito tempo passa a dar erro honesto, em vez de catálogo
  possivelmente desatualizado — inclusive quanto a vídeos removidos lá.
- Existe o registro que a lei exige, e **só** ele.
- O prazo é cumprido nas duas pontas: guardar seis meses, e não guardar mais.
- Exclusão de conta continua apagando e-mail, senha, sessões, verificação de
  idade e aceites.

**Negativas / custos aceitos**

- **Queda longa da origem derruba o catálogo.** Era o objetivo, e ainda assim
  significa site inutilizável em pane prolongada de terceiro.
- O cache é em memória: um reinício joga tudo fora e a primeira queda depois
  dele não tem nada para servir.
- **O registro de acesso é tudo o que temos.** Se uma autoridade pedir "quem
  assistiu tal vídeo", não há resposta — por decisão, não por falha.
- `trust proxy: 1` depende de o provedor pôr exatamente um proxy à frente.
  Mudança de arquitetura (CDN na frente, por exemplo) exige revisar o número,
  ou o IP registrado passa a ser o do intermediário.
- Em desenvolvimento local, o IP registrado é `::1` — correto e inútil.
- A faxina roda **no processo da API**. Se ele ficar semanas sem reiniciar e o
  temporizador falhar, nada apaga — não há tarefa agendada por fora.

## Alternativas consideradas

- **Manter o cache expirado sem teto** — catálogo sempre de pé, e risco de
  servir por tempo indeterminado conteúdo que a origem já removeu.
- **Não usar cache expirado em nenhuma hipótese** — mais correto na teoria, e
  qualquer soluço de rede viraria erro para quem está navegando.
- **TTL maior em vez de teto** — confunde duas coisas: de quanto em quanto tempo
  reconsultar, e até quando aceitar dado velho quando não há como reconsultar.
- **Registrar cada requisição** — rastro completo, útil para depurar, e um
  histórico de navegação pornográfica por pessoa que ninguém pediu.
- **Registrar também o vídeo aberto** — ajudaria a atender pedido de autoridade
  sobre um vídeo específico, e criaria exatamente a base que não queremos ter.
- **Não registrar nada** — menos dado guardado, e descumprimento do art. 15.
- **`CASCADE` em `access_logs.user_id`** — coerente com o resto do banco, e
  apagaria antes do prazo o registro que a lei manda guardar.

## Referências

- `src/services/cache.js`, `src/services/pornhubClient.js` (`maxStaleSeconds`),
  `src/services/accessLogService.js`, `src/routes/auth.js` (o login),
  `src/app.js` (`trust proxy`), `src/server.js` (a faxina), `src/db/schema.sql`
- `test/client.test.js` (o teto), `test/accessLog.test.js` (o que entra e o que
  nunca entra), `test/routes.test.js` (uma linha por login, nenhuma por
  navegação), `test/usersService.test.js` (sobreviver à exclusão da conta, com
  `TEST_DATABASE_URL`)
- [ADR-0017](0017-denuncia-remocao-e-bloqueio.md) — por que dado velho sobre o
  catálogo passou a ser um problema
- A Política de Privacidade, no repositório do front, descreve estes seis meses
