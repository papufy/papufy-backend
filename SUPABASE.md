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

Migrações em `supabase/migrations/`. Aplicar em ordem no **SQL Editor** do dashboard ou via `supabase db push`.

| Arquivo | Conteúdo |
|---------|----------|
| `20260322000000_papufy_initial_schema.sql` | Schema inicial |
| `20260617120000_enable_rls_all_tables.sql` | **RLS em todas as tabelas** (corrige alerta `rls_disabled_in_public`) |

### Segurança (RLS)

O frontend **não** acessa o Supabase diretamente — só o backend (Render) com `service_role`. Mesmo assim, tabelas sem RLS ficam expostas pela API pública do projeto (chave `anon`).

A migração `20260617120000_enable_rls_all_tables.sql` ativa RLS em todas as tabelas **sem policies** para `anon`/`authenticated` (acesso negado por padrão). O `service_role` continua com acesso total.

**Aplicar agora (SQL Editor):** Dashboard → SQL → New query → colar o conteúdo da migração → Run.

Depois, em **Database → Advisors → Security**, o alerta deve sumir.

## Seed

```bash
npm run db:seed
```

Requer `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente (Shell do Render ou `.env` local só para rodar seed manual).

## Frontend

O app Vercel **não** usa Supabase diretamente — só `VITE_API_URL` → Render.
