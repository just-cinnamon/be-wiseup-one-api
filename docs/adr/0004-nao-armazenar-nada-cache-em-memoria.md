# ADR-0004 — Não armazenar nada: só cache em memória, que devolve dado velho no erro

- **Status:** aceita, **substituída parcialmente** por
  [ADR-0011](0011-contas-em-sqlite-limitando-a-0004.md) — continua valendo para
  catálogo, mídia e histórico de uso; deixa de valer para credenciais, que
  passam a ficar em SQLite
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O back-end intermedeia conteúdo adulto de terceiros. Guardar qualquer coisa traz
peso jurídico e operacional desproporcional a um projeto de estudo:

- **vídeo ou miniatura rehospedada** = redistribuição de obra de terceiros, e as
  miniaturas vêm com URL assinada e validade de ~24h (reescrever a URL devolve
  HTTP 471, ver [ADR-0009](0009-miniaturas-320x180.md));
- **metadados em banco** = cópia de catálogo que envelhece e precisa de rotina
  de sincronização;
- **histórico de quem assistiu ou buscou** = dado pessoal sensível, com as
  obrigações da LGPD, num projeto sem base legal nem política de privacidade.

Ao mesmo tempo, `/api/home` dispara oito buscas na API externa. Sem nenhum
cache, cada visita custa oito requisições a um serviço de terceiros que pode
limitar ou cair.

## Decisão

**Nada é persistido.** Sem banco, sem disco, sem download de mídia. O único
armazenamento é um cache **em memória** das respostas JSON da API externa, que
some quando o processo reinicia.

Na prática (`src/services/cache.js`, `src/services/pornhubClient.js`):

- chave do cache = a URL completa da chamada à API externa;
- validade de 10 minutos (`CACHE_TTL_SECONDS`), no máximo 500 entradas;
- limite estourado remove a entrada mais antiga (`Map` mantém ordem de
  inserção);
- **resposta expirada vale mais que erro**: se a API externa falhar e houver
  valor antigo em cache, ele é devolvido em vez de 502/504 — é a única razão
  para o cache guardar entradas vencidas em vez de apagá-las;
- o navegador também guarda: `Cache-Control: public, max-age=300` nas listas e
  `86400` em `/api/categories`;
- vídeos tocam pelo embed oficial (`embedUrl`), servido pelo Pornhub;
- o log registra método, rota, status e tempo — **nunca** termo de busca,
  identificador de vídeo, IP ou qualquer dado de quem usa.

## Consequências

**Positivas**

- Nenhum dado pessoal existe, então não há o que vazar, exportar ou excluir a
  pedido.
- Nada de obra de terceiros é redistribuído: só metadados em trânsito.
- Sem banco, sem _migration_, sem _backup_, sem credencial de banco para
  rotacionar. O deploy é `npm install` + `npm start`.
- A segunda chamada igual a `/api/home` responde em ~10ms contra ~30ms da
  primeira (medido local), e o cache é compartilhado por todas as pessoas.
- Instabilidade curta da API externa fica invisível: a página continua
  carregando com dados de até 10 minutos antes.

**Negativas / custos aceitos**

- **Cache zerado a cada reinício ou deploy.** No plano gratuito do Render o
  serviço dorme em ~15 min de inatividade, então na prática o cache quase sempre
  começa vazio.
- Não escala horizontalmente: duas instâncias teriam dois caches independentes.
- **O dado devolvido no erro pode estar bem velho.** A entrada só sai do cache
  ao estourar as 500 ou ao reiniciar; se a API externa ficar fora por horas, o
  front mostra conteúdo de horas atrás sem avisar que está desatualizado.
- 500 entradas de JSON na memória do processo, num plano de 512MB. Respostas de
  busca têm ~170KB cada, o que no limite é significativo — mitigado pelo TTL
  curto e pelo volume baixo de buscas distintas.
- Sem histórico próprio, "Continuar assistindo" precisa vir do `localStorage` do
  front, e por isso não acompanha a pessoa entre dispositivos.
- Nenhuma estatística de uso: não há como saber o que foi mais buscado.

## Alternativas consideradas

- **Redis** — resolveria o cache compartilhado e a sobrevivência a reinícios,
  mas é mais um serviço para publicar e pagar, e passaria a haver estado
  persistido fora do processo.
- **Cache em disco** — sobreviveria ao reinício, mas o disco do plano gratuito do
  Render é efêmero, e gravar respostas de conteúdo adulto em arquivo é
  exatamente o que esta ADR quer evitar.
- **Apagar a entrada ao expirar** (cache estrito) — mais previsível, porém
  trocaria "dado de 10 minutos atrás" por "tela de erro" a cada oscilação da API
  externa. Para um catálogo de vídeos, dado velho é melhor que página vazia.
- **Banco com o catálogo sincronizado** — daria busca própria, paginação real e
  independência da API externa, ao custo de armazenar catálogo de terceiros e
  manter rotina de sincronização.
- **Guardar histórico de quem assiste no servidor** — permitiria "Continuar
  assistindo" entre dispositivos, mas exigiria conta, consentimento e política
  de privacidade. Fora do escopo.

## Referências

- `src/services/cache.js`, `src/services/pornhubClient.js`
- `src/routes/index.js` (`cacheFor`)
- `src/app.js` (log sem termo de busca)
- `src/mappers/videoMapper.js` → `toTitleDetail` (`embedUrl`)
- `test/client.test.js` → "usa o cache e, se a API falhar, devolve a resposta expirada"
- `README.md` → "Não armazena vídeos nem dados de usuário"
