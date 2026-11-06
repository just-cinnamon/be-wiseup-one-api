# Passo a passo — ligar o login de verdade

Para quem vai executar, não para quem já sabe. Cada passo diz **o que fazer**,
**o que esperar** e **o que fazer se der errado**.

Ordem obrigatória: o passo 4 do front só funciona depois do passo 3.

## Por que isto é necessário

Hoje o login do front não confere senha nenhuma: o `.env` dele está com
`VITE_AUTH_MODE=local`, que nem chama a API. E a API publicada no Render é uma
**build antiga**, de antes da autenticação: ela entrega o catálogo a qualquer
pessoa com a URL.

A causa da build antiga é de propósito: sem `DATABASE_URL`, o processo se recusa
a subir (`"DATABASE_URL não está definida: sem banco não há login, denúncia nem
aceite de termos"`). O Render tenta a build nova, ela não sobe, e ele mantém a
anterior no ar. É por isso que o passo 1 vem primeiro.

Para ver o estado atual a qualquer momento:

```powershell
node scripts/conferir-producao.mjs https://be-wiseup-one-api.onrender.com
```

## 1. Criar o Postgres

No <https://dashboard.render.com>: **New → Postgres**. Nome qualquer (ex.:
`be-wiseup-one-db`), região **a mesma do serviço da API** (senão a conexão sai
pela internet, mais lenta), plano gratuito.

Quando terminar de criar, copie a **Internal Database URL** — a que começa com
`postgresql://` e termina sem `.render.com` externo. A interna só é alcançável
de dentro do Render, o que é exatamente o que queremos.

> **Prazo do plano gratuito.** O Postgres gratuito do Render tem validade (o
> banco é removido depois de um tempo, e a página do plano diz quanto). Confira
> na hora de criar. Se não servir, [Neon](https://neon.tech) e
> [Supabase](https://supabase.com) têm gratuito sem prazo, com hibernação; nos
> dois casos o que muda aqui é só o valor de `DATABASE_URL`, porque o código usa
> `pg` puro (ADR-0013).

**Se der errado:** região diferente da API funciona, mas use a _External_
Database URL nesse caso, e aceite a latência.

## 2. Cadastrar as variáveis na API

No serviço da API → **Environment** → **Add Environment Variable**:

| Variável                | Valor                           | Para quê                                           |
| ----------------------- | ------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`          | a URL copiada no passo 1        | sem ela o processo não sobe                        |
| `SEED_USERS`            | `seuemail@dominio.com:suasenha` | **é assim que a sua conta nasce**                  |
| `CORS_ORIGINS`          | a URL do front publicado        | só quando o front estiver na Vercel                |
| `DATABASE_SSL_INSECURE` | `true`                          | **só** se o passo 3 falhar com erro de certificado |

Sobre o `SEED_USERS`: **não existe tela de cadastro** — está fora do escopo pelo
§9 do `plano-autenticacao.md`. As contas nascem desta variável, no boot, uma por
entrada, separadas por vírgula (`a@x.com:senha1,b@x.com:senha2`). A senha vai
em texto puro na variável e é guardada no banco com `scrypt`; quem vê o painel
do Render vê a senha, então use uma que não seja reaproveitada de outro lugar.

Opcional, se quiser o captcha de volta: `RECAPTCHA_SECRET`. Sem ele, o captcha
não é exigido (ADR-0014) — é o que permite o front atual, sem widget, entrar.

## 3. Publicar a build atual

No serviço da API → **Manual Deploy** → **Deploy latest commit**.

**O que esperar no log**, em ordem:

```
Moderação: 0 vídeo(s) fora do catálogo.
Banco conectado: 1 conta(s) em SEED_USERS, 1 criada(s) agora.
API ouvindo na porta 10000
```

**Se der errado:**

- `DATABASE_URL não está definida` → a variável não foi salva, ou o deploy saiu
  antes dela. Salve e implante de novo.
- `self-signed certificate` / `certificate` → cadastre `DATABASE_SSL_INSECURE=true`
  e implante de novo. É escolha explícita, e o comentário em `db/database.js`
  explica o custo.
- `ECONNREFUSED` ou timeout → URL interna de um banco em outra região. Use a
  externa.
- `0 criada(s) agora` **e** nenhuma conta → o formato do `SEED_USERS` está
  errado; tem de ser `email:senha`, sem espaços.

## 4. Conferir de fora

```powershell
node scripts/conferir-producao.mjs https://be-wiseup-one-api.onrender.com seuemail@dominio.com suasenha
```

As nove checagens têm de passar. As que mais importam:

- **catálogo fechado sem sessão** — se continuar `HTTP 200`, a build no ar ainda
  é a antiga e o catálogo está aberto a qualquer um. Não siga para o passo 5.
- **a conta informada entra** — confirma que o `SEED_USERS` funcionou.
- **a confirmação registra idade e termos juntos** — confirma a ADR-0019.

## 5. Ligar o front

No `.env` do repositório do front (`be-wiseup-one`):

```
VITE_API_BASE_URL=https://be-wiseup-one-api.onrender.com/api
VITE_AUTH_MODE=api
```

Reinicie o `npm run dev` — o Vite só lê o `.env` ao subir.

**O que esperar**, na ordem: a porta **+18** em `/entrada` (aviso de conteúdo
adulto, antes do login), a tela de entrar **sem** a faixa laranja de modo local,
senha errada mostrando "E-mail ou senha incorretos.", e a senha certa caindo
direto em `/perfis` — a confirmação +18 feita antes do login é registrada na
conta sozinha (ADR-0016 do front).

**Se der errado:**

- Faixa laranja ainda na tela → o `npm run dev` não foi reiniciado.
- "Sem conexão com o servidor" → a API hibernou; a primeira chamada leva até um
  minuto. Tente de novo.
- Senha certa dando "E-mail ou senha incorretos" → o e-mail do `SEED_USERS` é
  outro, ou a conta foi criada antes com senha diferente (o seed **não**
  reescreve senha de conta existente).
- Erro de CORS no console → `CORS_ORIGINS` não tem a origem do front. Em
  desenvolvimento, o padrão já cobre `http://localhost:5173`.

## 6. Dar o crachá de moderação a alguém

A fila de denúncias (`/api/reports`) só responde para conta com `is_admin`, e
isso é à mão, de propósito. No painel do banco, aba **Shell** (ou `psql` com a
External URL):

```sql
UPDATE users SET is_admin = 1 WHERE email = 'seuemail@dominio.com';
```

Depois **saia e entre de novo** na conta: o crachá entra na sessão no login.

## 7. Rodar os testes de SQL contra um banco de verdade

São 21 testes que nunca rodaram aqui — eles são pulados sem a variável. Use um
banco **de teste** (eles apagam o que criam):

```powershell
$env:TEST_DATABASE_URL="postgresql://..."; npm test
```

## Depois disso

O que continua pendente, e não depende de nenhum destes passos: revisão jurídica
dos textos legais (que são rascunho e dizem isso na própria página) e preencher
no texto o responsável pelo site, o e-mail de denúncia e o encarregado de dados.
