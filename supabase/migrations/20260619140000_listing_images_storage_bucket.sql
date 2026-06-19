-- Bucket público para fotos de anúncios (persistente; não depende do disco do Render).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listings',
  'listings',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read listing images" ON storage.objects;

CREATE POLICY "Public read listing images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'listings');
