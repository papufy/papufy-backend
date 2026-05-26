import fs from "fs";

export type AllowedFileKind = "pdf" | "jpeg" | "png";

const PDF_HEADER = Buffer.from("%PDF");
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function startsWith(buf: Buffer, header: Buffer): boolean {
  return buf.length >= header.length && buf.subarray(0, header.length).equals(header);
}

export async function assertFileMagic(
  filePath: string,
  kind: AllowedFileKind
): Promise<void> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    const slice = header.subarray(0, bytesRead);

    if (kind === "pdf" && !startsWith(slice, PDF_HEADER)) {
      throw new Error("O arquivo não é um PDF válido.");
    }
    if (kind === "jpeg" && !startsWith(slice, JPEG_HEADER)) {
      throw new Error("A imagem não é um JPEG válido.");
    }
    if (kind === "png" && !startsWith(slice, PNG_HEADER)) {
      throw new Error("A imagem não é um PNG válido.");
    }
  } finally {
    await handle.close();
  }
}

export function extensionForMime(mimetype: string): string {
  if (mimetype === "application/pdf") return ".pdf";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/jpeg") return ".jpg";
  return "";
}
