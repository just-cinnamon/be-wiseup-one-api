/**
 * Confere a versão do Node antes de qualquer outra coisa.
 *
 * Precisa ser o primeiro import de server.js: em ESM os imports são avaliados
 * na ordem em que aparecem, e o Express 5 (que exige Node >= 18) falha ao
 * carregar em versões antigas, com um erro que não diz qual é o problema.
 */
const MINIMUM = [22, 9];

const [major, minor] = process.versions.node.split('.').map(Number);

if (major < MINIMUM[0] || (major === MINIMUM[0] && minor < MINIMUM[1])) {
  console.error(
    [
      '',
      `ERRO: esta API precisa do Node ${MINIMUM.join('.')} ou maior.`,
      `Este ambiente está com o Node ${process.versions.node}.`,
      '',
      'No Render: Environment -> cadastre NODE_VERSION = 22, salve e refaça o',
      'deploy com "Clear build cache & deploy".',
      'No seu micro: winget upgrade --id OpenJS.NodeJS.LTS -e',
      '',
    ].join('\n')
  );
  process.exit(1);
}
