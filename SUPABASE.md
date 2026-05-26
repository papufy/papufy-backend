# Supabase — Papufy

## Projeto

- **Ref:** `lyxdjprsfstxqakudhjd`
- **API:** https://supabase.com/dashboard/project/lyxdjprsfstxqakudhjd/settings/api

## Variáveis no Render (runtime)

| Variável | Onde pegar |
|----------|------------|
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role (secret) |

O backend usa `@supabase/supabase-js` com **service_role** (acesso total; não expor no frontend).

Guia: `../env-database.txt`

## Schema

Migration SQL: `supabase/migrations/20260322000000_papufy_initial_schema.sql`

## Seed

```bash
npm run db:seed
```

Requer `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente (Shell do Render ou `.env` local só para rodar seed manual).

## Frontend

O app Vercel **não** usa Supabase diretamente — só `VITE_API_URL` → Render.
