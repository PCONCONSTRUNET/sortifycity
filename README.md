# Sortify City (MVP)

MVP de um SaaS de sorteios para multiplas lojas.

## Funcionalidades iniciais

- Tela inicial com abas de `Login` e `Cadastro`.
- Cadastro de loja com:
  - Nome da loja
  - Email
  - CPF/CNPJ
  - WhatsApp
  - Senha
- Painel de cliente apos login.
- Criacao de sorteio com:
  - Titulo
  - Premio/descricao
  - Lista de participantes (1 por linha)
  - Timer opcional
  - Opcao de auto sorteio ao encerrar timer
- Botao `Sortear agora` (manual), mesmo com timer ativo.
- Auto sorteio por timer (quando habilitado).

## Como executar

1. Instalar dependencias:

```bash
npm install
```

2. Rodar aplicacao:

```bash
npm start
```

3. Abrir no navegador:

`http://localhost:3000`

## Deploy (Render)

Como este projeto é um servidor Node/Express (EJS), no Render você pode hospedar como **Web Service**.

1. No Render, crie um **New → Web Service** conectando este repositório.
2. Se o Render detectar o `render.yaml`, ele deve usar:
   - `Build Command: npm install`
   - `Start Command: npm start`
   - `Health Check Path: /`
3. Configure as variáveis de ambiente (recomendadas):
   - `SESSION_SECRET`
   - `ADMIN_PASSWORD`
   - `PUBLIC_BASE_URL` (use a URL do seu serviço no Render)
   - `DATABASE_URL` (opcional; se não usar, o app vai usar SQLite local)
   - `PAGBANK_TOKEN` (se for usar pagamentos)

Você pode copiar os valores base do arquivo `.env.example`.

## Observacoes

- Banco SQLite local em `data.sqlite` por padrao.
- Sessoes em `sessions.sqlite`.
- Para producao, altere `SESSION_SECRET`.

## PagBank

O painel de plano aceita pagamento online pelo PagBank:

- Pix: gera QR Code e codigo copia e cola em um modal dentro do sistema.
- Cartao: abre o checkout seguro do PagBank em uma nova aba.

Configure no `.env`:

```bash
PAGBANK_ENV=sandbox
PAGBANK_TOKEN=seu-token
PAGBANK_PIX_EXPIRES_HOURS=24
PUBLIC_BASE_URL=https://seu-dominio.com
```

Para webhook em producao, `PUBLIC_BASE_URL` precisa ser uma URL publica acessivel pelo PagBank.

## Supabase

Para usar Supabase/Postgres, crie um arquivo `.env` a partir de `.env.example` e preencha `DATABASE_URL` com a connection string do projeto Supabase.

Depois de configurar a URL:

```bash
npm run migrate:supabase
npm start
```

O script de migracao copia os dados do `data.sqlite` local para o banco Supabase configurado.
