/**
 * Seções da Home. Para mudar as fileiras, edite só esta lista.
 * `params` são repassados ao endpoint `search` da API externa.
 *
 * Fileiras por categoria usam `period: 'alltime'`: com `weekly` ou `monthly`
 * a API devolve poucos vídeos em categorias de nicho (brazilian deu 2 e 4),
 * e um carrossel com 4 itens parece quebrado.
 */
export const featuredParams = { ordering: 'rating', period: 'weekly' };

export const top10Params = { ordering: 'mostviewed', period: 'weekly' };

export const homeRows = [
  {
    id: 'em-alta',
    title: 'Em alta na semana',
    params: { ordering: 'mostviewed', period: 'weekly' },
  },
  { id: 'lancamentos', title: 'Lançamentos', params: { ordering: 'newest' } },
  {
    id: 'mais-bem-avaliados',
    title: 'Mais bem avaliados',
    params: { ordering: 'rating', period: 'monthly' },
  },
  {
    id: 'cat-amateur',
    title: 'Amador',
    params: { category: 'amateur', ordering: 'mostviewed', period: 'alltime' },
  },
  {
    id: 'cat-brazilian',
    title: 'Brasileiros',
    params: { category: 'brazilian', ordering: 'mostviewed', period: 'alltime' },
  },
  {
    id: 'cat-romantic',
    title: 'Romântico',
    params: { category: 'romantic', ordering: 'mostviewed', period: 'alltime' },
  },
];
