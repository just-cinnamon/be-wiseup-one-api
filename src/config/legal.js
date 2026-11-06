/**
 * Versão vigente de cada documento legal (ADR-0016).
 *
 * Mudar uma data aqui **obriga todo mundo a aceitar de novo**: o aceite é
 * gravado por versão, e `requireTerms` compara com estas. É de propósito que
 * seja uma constante no código e não uma linha no banco — a versão anda junto
 * com o texto, que também está no repositório (no front).
 *
 * Só mude quando o texto mudar de conteúdo. Correção de vírgula não é versão
 * nova: forçar aceite por nada ensina a clicar sem ler.
 */
export const LEGAL_VERSIONS = {
  termos: '2026-11-05',
  privacidade: '2026-11-05',
};

/** Os dois documentos que exigem aceite, na ordem em que aparecem na tela. */
export const LEGAL_DOCUMENTS = Object.keys(LEGAL_VERSIONS);
