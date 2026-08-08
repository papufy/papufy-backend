import crypto from "crypto";
import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabase";
import { AppError } from "../utils/errors";

const BUCKET = "user-files";

function extensionForMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "application/pdf") return ".pdf";
  return path.extname(mime) || ".bin";
}

export async function uploadUserFile(
  folder: "avatars" | "curriculos" | "certificados",
  file: Express.Multer.File,
  userId: string
): Promise<string> {
  const ext = extensionForMime(file.mimetype);
  const objectPath = `${folder}/${userId}/${crypto.randomUUID()}${ext}`;

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(file.path);
  } catch {
    throw new AppError("Não foi possível ler o arquivo enviado.", 400);
  }

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: file.mimetype,
    upsert: false,
    cacheControl: "31536000",
  });

  fs.unlink(file.path, () => undefined);

  if (error) {
    throw new AppError(
      `Falha ao salvar arquivo no storage: ${error.message}`,
      500
    );
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
