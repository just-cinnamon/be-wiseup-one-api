# ADR-0017 — Denúncia, remoção imediata e lista de bloqueio

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 3 do plano de prevenção

## Contexto

O acervo é de terceiros: o catálogo mostra o que a plataforma de origem publica,
e **ninguém revisa cada vídeo** antes de ele aparecer na Home. Isso não é
descuido de implementação, é a natureza do produto — e significa que conteúdo
que não pode existir pode, em algum momento, estar listado aqui.

Até esta fase não havia nenhuma forma de tirar um vídeo do ar. Nem denúncia, nem
bloqueio manual: a única saída seria mudar o código.

Para conteúdo com menor de idade ou sem consentimento, "abrir um formulário e
responder em alguns dias" não serve. O vídeo tem de sair **antes** de alguém
analisar.

## Decisão

**Denúncia que remove na hora, para os dois motivos que não admitem espera.**

### Motivos, e o que cada um faz

| Motivo              | O que acontece                                |
| ------------------- | --------------------------------------------- |
| `menor`             | sai do catálogo **na hora**, antes da análise |
| `sem_consentimento` | sai do catálogo **na hora**, antes da análise |
| `violencia`         | entra na fila de análise                      |
| `direitos_autorais` | entra na fila de análise                      |
| `outro`             | entra na fila de análise                      |

Lista fechada (`REASONS`): motivo em campo livre não dá para tratar
automaticamente, e tratamento automático é justamente o que os dois primeiros
motivos exigem.

### A remoção e a denúncia acontecem juntas

`createMaybeBlocking` roda **numa transação** (`db.transaction`). Denúncia
registrada com o vídeo ainda no ar, porque a segunda consulta falhou, é pior do
que nenhuma das duas: alguém acredita ter denunciado, e nada aconteceu. O
`pool.query` do `pg` pega uma conexão qualquer por chamada, então `BEGIN` e
`COMMIT` soltos não garantiriam nada — daí a transação explícita no
`database.js`.

A denúncia fica com status `aberta` mesmo quando o vídeo já saiu: o bloqueio
imediato vem **antes** da análise, não **em vez** dela.

### Filtro em um lugar só

`videosService` recebe `moderation` no construtor e filtra Home, busca e
detalhe. O detalhe de vídeo bloqueado é **404, não 403**: dizer "este vídeo foi
bloqueado" confirmaria que ele existe e contaria o que a denúncia conseguiu.

A lista de bloqueados vive **em memória** (`Set` de ids), relida do banco no
boot e a cada sincronismo. É consultada em toda requisição de catálogo, e uma
consulta por requisição para uma lista pequena não se paga.

### Limite de 10 denúncias por hora, por conta

Não é defesa contra abuso coordenado — é o que impede **uma** conta de limpar o
catálogo sozinha num laço. O limite vale inclusive para `menor`: a conta que já
fez dez denúncias numa hora não é a última linha de defesa do site.

### Decisão humana

- `is_admin` é coluna em `users`, **marcada à mão no banco**. Não existe rota que
  promova ninguém: administrador se ganha por fora, não por requisição HTTP.
- `procede` bloqueia. `improcede` só devolve o vídeo ao ar se o bloqueio tiver
  vindo **daquela** denúncia — bloqueio de outra denúncia, decisão manual ou
  remoção na origem não é desfeito por essa via.
- Denúncia analisada não volta para a fila.

### Sincronismo com a origem

A cada 6 horas e no boot, `deletedVideos` traz o que a plataforma apagou, e
esses ids entram na lista de bloqueio. Vídeo removido lá costuma ter sido
removido **por um motivo**, e nosso catálogo não deveria ser o último lugar onde
ele segue listado. Falha de rede não derruba nada: o catálogo continua com a
lista que tem.

### A denúncia sobrevive à conta

`reports.user_id` é `ON DELETE SET NULL`, e não `CASCADE`. Se alguém denuncia
conteúdo com menor de idade e depois exclui a conta, a denúncia continua
valendo: ela é sobre o vídeo, não sobre quem denunciou. O vínculo com a pessoa
desaparece, o registro fica.

## Consequências

**Positivas**

- Existe um caminho — em segundos — para tirar do ar conteúdo criminoso, sem
  deploy.
- O que a origem remove sai daqui sozinho.
- Vídeo bloqueado desaparece de Home, busca e detalhe de uma vez, porque o
  filtro está num lugar só.
- Exclusão de conta (LGPD) não apaga denúncia de conteúdo grave.

**Negativas / custos aceitos**

- **Qualquer conta tira qualquer vídeo do ar**, dez por hora, escolhendo
  `menor`. É abuso fácil, e ainda assim é a escolha certa: o custo de um falso
  positivo é um vídeo a menos no catálogo, e o de um falso negativo é crime no
  ar.
- **A lista em memória é por processo.** Com mais de uma instância, o bloqueio
  feito em uma só chega às outras no próximo `refresh()` (até 6 horas). Para uma
  instância no plano gratuito não há problema; ao escalar, isto precisa virar
  consulta ao banco ou aviso entre instâncias.
- **Não há fila de análise com gente nela.** O mecanismo está pronto; quem olha
  não existe ainda, e `is_admin` não está marcado para ninguém.
- Vídeo bloqueado por engano depende de alguém com `is_admin` para voltar.
- O formato do endpoint `deleted` da Webmasters API é **esperado**, não
  verificado contra a API real: o código aceita id solto e objeto com
  `video_id`, e formato inesperado vira lista vazia.
- Nada impede a mesma conta de denunciar o mesmo vídeo duas vezes (a segunda não
  muda nada, mas ocupa uma das dez).

## Alternativas consideradas

- **Formulário por e-mail, sem botão** — zero código e remoção em dias. Para
  conteúdo com menor de idade, dias é resposta errada.
- **Analisar antes de remover, em todos os motivos** — evita abuso e deixa
  conteúdo criminoso no ar enquanto a análise não acontece. Invertido:
  remove-se primeiro nos dois motivos graves.
- **Remover na hora em todos os motivos** — transforma "direitos autorais" e
  "não gostei" em botão de censura instantânea, sem o motivo que justifica a
  pressa.
- **Consultar `blocked_videos` em cada requisição** — sempre atualizado, e uma
  consulta a mais por requisição de catálogo em banco de plano gratuito.
- **Guardar o motivo como texto livre** — mais informação para quem analisa, e
  nenhuma forma de decidir automaticamente o que bloqueia na hora.
- **`CASCADE` em `reports.user_id`** — mais simples, e apaga denúncia de
  conteúdo grave quando a conta sai.

## Referências

- `src/services/moderationService.js` (regras), `src/services/reportsService.js`
  (SQL), `src/routes/reports.js`, `src/http/requireAdmin.js`,
  `src/db/database.js` (`transaction`), `src/db/schema.sql`
- `test/moderationService.test.js`, `test/videosService.test.js` (o filtro),
  `test/routes.test.js` (as rotas e o `is_admin`),
  `test/reportsService.test.js` (a transação e o SET NULL, com
  `TEST_DATABASE_URL`), `test/client.test.js` (o `deleted`)
- [ADR-0015](0015-verificacao-de-idade-no-servidor.md) e
  [ADR-0016](0016-aceite-de-termos-por-versao.md) — as barreiras anteriores
- [ADR-0005](0005-servicos-recebem-dependencias.md) — por que `client` e
  `reports` entram por parâmetro
