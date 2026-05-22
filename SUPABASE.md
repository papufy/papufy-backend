# Supabase — Papufy

## Projeto

- **Ref:** `lyxdjprsfstxqakudhjd`
- **URL:** https://supabase.com/dashboard/project/lyxdjprsfstxqakudhjd

## Connection strings (Render)

Em **Settings → Database**:

| Variável Render | Tipo no Supabase |
|-----------------|------------------|
| `DATABASE_URL` | URI **Transaction pooler** (porta 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | URI **Direct connection** (porta 5432) |

Substitua `[YOUR-PASSWORD]` pela senha do banco.

## Schema

Migration: `supabase/migrations/20260322000000_papufy_initial_schema.sql`

Já aplicada no projeto remoto. Para replicar em outro ambiente:

```bash
# Com Supabase CLI linkado ao projeto
supabase db push
```

## Seed (dados demo)

Com as variáveis do Render exportadas localmente **ou** no Shell do Render:

```bash
npm run db:seed
```

## Segurança

A API usa a connection string **postgres** (servidor Node no Render), não a chave `anon` do Supabase. Não exponha a `service_role` nem a `anon` no frontend.

RLS está desabilitado nas tabelas — adequado enquanto só o backend acessa o banco. Se no futuro usar **Supabase Client** no browser, habilite RLS e crie policies.
