# Papufy API

Node.js + Express + Prisma + **Supabase PostgreSQL**.

## Deploy (Render)

1. Conecte [github.com/papufy/papufy-backend](https://github.com/papufy/papufy-backend).
2. Build: `npm ci --include=dev && npx prisma generate && npm run build`  
   (no Render, `NODE_ENV=production` omite devDependencies; `--include=dev` instala TypeScript e `@types/*` para o `tsc`.)
3. Start: `npm run start`
4. Health: `/health`
5. Variáveis: copie `env.render.template` → painel Render.

## Após o 1º deploy

Shell do Render:

```bash
npm run db:seed
```

## Banco Supabase

Ver [SUPABASE.md](./SUPABASE.md). Schema já criado no projeto `lyxdjprsfstxqakudhjd`.
