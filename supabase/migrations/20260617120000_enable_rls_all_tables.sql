-- Bloqueia acesso público via PostgREST (anon/authenticated).
-- O backend Papufy usa service_role, que ignora RLS — nenhuma policy é necessária.
-- Idempotente: pode rodar mais de uma vez.

BEGIN;

ALTER TABLE IF EXISTS "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Listing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ListingImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "JobInterest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "SupportTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Review" ENABLE ROW LEVEL SECURITY;

-- Garante RLS em tabelas futuras criadas no schema public (defesa em profundidade).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', r.tablename);
  END LOOP;
END $$;

COMMIT;
