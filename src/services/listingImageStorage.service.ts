import crypto from "crypto";
import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabase";
import { AppError } from "../utils/errors";

const BUCKET = "listings";

function extensionForMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return path.extname(mime) || ".jpg";
}

export async function uploadListingImage(
  file: Express.Multer.File
): Promise<string> {
  const ext = extensionForMime(file.mimetype);
  const objectPath = `${crypto.randomUUID()}${ext}`;

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(file.path);
  } catch {
    throw new AppError("Não foi possível ler a imagem enviada.", 400);
  }

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: file.mimetype,
    upsert: false,
    cacheControl: "31536000",
  });

  fs.unlink(file.path, () => undefined);

  if (error) {
    throw new AppError(
      `Falha ao salvar imagem no storage: ${error.message}`,
      500
    );
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function uploadListingImages(
  files: Express.Multer.File[]
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    urls.push(await uploadListingImage(file));
  }
  return urls;
}
