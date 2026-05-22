# Papufy API

Backend Node.js + Express + Prisma + PostgreSQL (Supabase).

## Deploy no Render

1. Conecte este repositório em [Render Dashboard](https://dashboard.render.com).
2. Use o `render.yaml` ou crie um **Web Service** Node:
   - **Build:** `npm ci && npx prisma generate && npm run build && npx prisma db push`
   - **Start:** `npm run start`
   - **Health check:** `/health`
3. Copie as variáveis de `.env` (raiz deste repo) para **Environment** no Render.
4. Após o primeiro deploy, rode o seed uma vez (Shell do Render):

```bash
npx tsx prisma/seed.ts
```

## Variáveis obrigatórias

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Supabase pooler (porta **6543**) |
| `DIRECT_URL` | Supabase direct (porta **5432**) |
| `JWT_SECRET` | Segredo forte (32+ chars) |
| `PUBLIC_BASE_URL` | URL do serviço Render (`https://....onrender.com`) |
| `FRONTEND_URL` | URL do app Vercel |
| `CORS_ORIGIN` | Mesma URL do frontend (opcional se usar `FRONTEND_URL`) |

## Local

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

API: http://127.0.0.1:3333/health
