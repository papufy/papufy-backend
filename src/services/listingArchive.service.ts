import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { supabase } from "../lib/db";

function deleteListingFile(relativeUrl: string) {
  if (!relativeUrl?.trim() || relativeUrl.startsWith("http")) {
    return;
  }
  const filePath = path.join(
    env.uploadDir,
    relativeUrl.replace(/\\/g, "/")
  );
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, () => undefined);
  }
}

/**
 * Encerra o anúncio após avaliação: remove fotos (disco + banco) e arquiva o registro.
 * Mantém Listing/Transaction/Review para histórico financeiro e reputação.
 */
export async function archiveListingAfterReview(
  listingId: string
): Promise<void> {
  const { data: images, error: imgListError } = await supabase
    .from("ListingImage")
    .select("id, url")
    .eq("listingId", listingId);

  if (imgListError) {
    throw new Error(imgListError.message);
  }

  for (const image of images ?? []) {
    deleteListingFile(image.url);
  }

  const { error: imgDeleteError } = await supabase
    .from("ListingImage")
    .delete()
    .eq("listingId", listingId);

  if (imgDeleteError) {
    throw new Error(imgDeleteError.message);
  }

  const now = new Date().toISOString();
  const { error: listingError } = await supabase
    .from("Listing")
    .update({
      status: "CLOSED",
      archivedAt: now,
      titulo: "Serviço concluído",
      descricao: "Este anúncio foi encerrado automaticamente após a avaliação.",
      telefone: "",
      cep: null,
      bairro: null,
      preco: null,
      aCombinar: true,
      updatedAt: now,
    })
    .eq("id", listingId);

  if (listingError) {
    throw new Error(listingError.message);
  }
}
