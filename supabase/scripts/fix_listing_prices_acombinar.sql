-- Corrige anúncios afetados pelo bug de aCombinar="false" interpretado como true.
-- Rode no SQL Editor se preços antigos sumiram (preco NULL + aCombinar true sem intenção).
-- Depois, peça aos usuários para reeditar o preço se ainda estiver errado.

UPDATE "Listing"
SET "aCombinar" = false
WHERE "aCombinar" = true
  AND "preco" IS NULL
  AND "descricao" NOT ILIKE '%a combinar%';
