# ADR-0009 — Aceitar miniaturas de 320x180 como limite da API

- **Status:** aceita
- **Data:** 2026-11-05
- **Fase do projeto:** Fase 4 — Integração com a API

## Contexto

O front é um clone de Netflix: banner de destaque ocupando a largura da tela,
cartões de fileira e pôster vertical no Top 10. Nas Fases 1 a 3 as imagens vinham
do `picsum.photos`, em qualquer resolução pedida.

A API externa aceita o parâmetro `thumbsize`, e o cliente pede
`thumbsize=large_hd` em toda chamada. Mas a resposta real, medida em
2026-11-05, devolve para **todos** os vídeos, em todas as miniaturas:

```
sizes distintos nos thumbs: [ '320x180' ]
```

As 16 miniaturas de cada vídeo são a mesma resolução. `default_thumb` e `thumb`
também: todas carregam `rs:fit:320:180` no caminho.

Tentou-se reescrever a URL trocando `rs:fit:320:180` por `rs:fit:1280:720`:

```
original:            HTTP 200, 9753 bytes
reescrito 1280x720:  HTTP 471, 448 bytes
```

A assinatura (`hdnea=st=...~exp=...~hmac=...`) cobre o caminho da URL, então
qualquer alteração a invalida. Não há como obter resolução maior.

## Decisão

Aceitar 320x180 como o teto disponível, **sem** tentar burlar a assinatura e
**sem** rehospedar imagem.

Na prática:

- `biggestThumb()` continua escolhendo a maior miniatura de `thumbs`, com
  `default_thumb` e `thumb` como reserva. Hoje todas empatam, e a função pega a
  primeira — mas se a API voltar a oferecer tamanhos diferentes, o código já
  aproveita sem mudança;
- `backdrop` e `poster` recebem a **mesma** URL: a API não tem versão vertical;
- nada de proxy de imagem, redimensionamento ou cache de mídia neste back-end
  (ver [ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md));
- a limitação fica registrada aqui e no README, porque é o tipo de coisa que se
  confunde com bug do front.

## Consequências

**Positivas**

- O back-end não assume responsabilidade por mídia: continua só repassando
  metadados.
- Imagens pequenas carregam rápido, inclusive em conexão ruim — o banner inteiro
  tem ~10KB.
- Nenhuma assinatura de URL de terceiro é manipulada, o que seria tentar
  contornar um controle de acesso do provedor.
- O código já está preparado se a API voltar a honrar `thumbsize`.

**Negativas / custos aceitos**

- **O banner fica visivelmente borrado.** Uma imagem de 320x180 esticada para a
  largura de um monitor é um upscale de 4x ou mais. É o defeito visual mais
  evidente do projeto integrado.
- O `Top10Card`, desenhado para pôster vertical (2:3), recebe imagem 16:9: ou
  corta, ou deforma, ou sobra espaço.
- As URLs **expiram em ~24h**. Com o cache de 10 minutos
  ([ADR-0004](0004-nao-armazenar-nada-cache-em-memoria.md)) isso não aparece em
  uso normal, mas qualquer `Title` guardado por mais tempo — no `localStorage` do
  "Continuar assistindo", por exemplo — vai ter imagem quebrada depois de um dia.
  O cartão do front tem fallback com o título, o que ameniza.
- `thumbsize=large_hd` continua sendo enviado sem efeito nenhum: parece que
  funciona, e não funciona.

## Alternativas consideradas

- **Reescrever a URL para pedir resolução maior** — testado: HTTP 471. Além de
  não funcionar, seria contornar a assinatura do provedor.
- **Extrair a imagem grande da página do vídeo** (_scraping_ de
  `view_video.php`) — provavelmente devolveria uma imagem melhor, mas é raspagem
  de página fora da API, frágil e contra os termos de uso.
- **Proxy de imagem no back-end, com upscale** — upscale não cria detalhe; só
  move o borrão para o nosso servidor e passa a trafegar mídia de terceiros por
  aqui.
- **Usar o `iframe` do embed como imagem do banner** — carregaria o player em
  toda a Home: pesado, com som e autoplay a controlar.
- **Esconder o banner e usar só fileiras** — resolveria o pior caso visual, mas
  descartaria o `Hero`, que é o centro do layout das Fases 1 a 3.
- **Tratar no front, com `blur` e gradiente sobre o banner** — não corrige a
  resolução, mas disfarça bem. Fica como sugestão para o front; não é decisão
  deste repositório.

## Referências

- `src/mappers/videoMapper.js` → `biggestThumb`
- `src/services/pornhubClient.js` (`thumbsize: 'large_hd'`)
- `test/fixtures/search.json` (miniaturas reais, todas 320x180)
- [ADR-0006](0006-converter-para-o-contrato-title.md) (`backdrop` e `poster` iguais)
- `README.md` → seção "Limitações conhecidas"
