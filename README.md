# Papufy API

Node.js + Express + **Supabase** (`@supabase/supabase-js`). O diretório `prisma/` é legado (não entra no build).

## Deploy (Render)

1. Conecte [github.com/papufy/papufy-backend](https://github.com/papufy/papufy-backend).
2. **Build command** (Settings → Build & Deploy):

   ```bash
   npm ci --include=dev && npm run build
   ```

   Não use `npx prisma generate` — o runtime não usa Prisma.

   Se o serviço foi criado via Blueprint, o `render.yaml` na raiz já define esse comando; serviços criados manualmente precisam colar o comando acima no painel.

3. **Start command:** `npm run start`
4. **Health check:** `/health`
5. Variáveis: copie `env.render.template` → painel Render.

## Após o 1º deploy

Shell do Render:

```bash
npm run db:seed
```

## Banco Supabase

Ver [SUPABASE.md](./SUPABASE.md). Migrações em `supabase/migrations/`.
