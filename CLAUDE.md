# CLAUDE.md

Contexto do projeto para sessões do Claude Code.

## Projeto
Back-end do `be-wiseup-one` (front React). Consome a Webmasters API do Pornhub e entrega os dados no formato `Title` do front (contrato em `src/data/mock.js` do front). **Não armazena nada**: sem banco, sem download ou rehospedagem de vídeos; só cache em memória das respostas JSON.

## Stack e comandos
- Node 22 + Express 5 + cors. JavaScript (ESM), sem TypeScript.
- `npm install`, `npm run dev`, `npm start`, `npm test`, `npm run lint`, `npm run format`.
- O usuário usa Windows + PowerShell + VS Code.

## Regras
- Só `GET`. Endpoints em `/api`: `health`, `home`, `videos`, `videos/:id`, `categories` (documentados no README).
- Toda chamada externa passa por `src/services/pornhubClient.js`; toda conversão por `src/mappers/videoMapper.js`.
- Regras dos endpoints em `src/services/videosService.js`, sem Express (testável com cliente falso).
- Erros sempre no formato `{ "error": { "code", "message" } }` via `src/http/errors.js`.
- Validar todo parâmetro por lista de valores permitidos.
- Logs sem termos de busca e sem dados de quem usa.
- Textos, comentários e README em português do Brasil.
- `node_modules/` e `package-lock.json` no `.gitignore`; deploy com `npm install`.

## Ao terminar uma etapa
1. `npm run lint` e `npm test` sem erros.
2. Testar os endpoints com `curl.exe`.
3. Atualizar o README (endpoints e diário de progresso).
4. Commit em português (`feat:`, `fix:`, `docs:`, `chore:`) e push na `main`.
