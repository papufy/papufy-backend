-- Foto de perfil no User + bucket persistente (Render tem disco efêmero).

ALTER TABLE IF EXISTS "User"
  ADD COLUMN IF NOT EXISTS "fotoUrl" TEXT;

COMMENT ON COLUMN "User"."fotoUrl" IS 'URL pública da foto de perfil (Supabase Storage)';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-files',
  'user-files',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read user files" ON storage.objects;

CREATE POLICY "Public read user files"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'user-files');
