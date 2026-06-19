/**
 * Remove todos os anúncios (Listing) e dados ligados a eles.
 * Uso: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env → npm run db:clear-listings
 */
import dotenv from "dotenv";
import { supabase } from "../src/lib/db";

dotenv.config();

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function deleteAll(table: string, column = "id") {
  const { error } = await supabase.from(table).delete().neq(column, "");
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function tableExists(table: string): Promise<boolean> {
  const { error } = await supabase.from(table).select("id", { head: true }).limit(1);
  if (!error) return true;
  if (error.code === "42P01" || error.message.includes("does not exist")) {
    return false;
  }
  throw new Error(`${table}: ${error.message}`);
}

async function deleteByTransactionIds(table: "Review" | "SupportTicket", ids: string[]) {
  if (ids.length === 0 || !(await tableExists(table))) return;
  const { error } = await supabase.from(table).delete().in("transactionId", ids);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env (Render → Environment)."
    );
  }

  const before = {
    listings: await countRows("Listing"),
    images: await countRows("ListingImage"),
  };

  console.log("[clear-listings] Antes:", before);

  if (before.listings === 0) {
    console.log("[clear-listings] Nenhum anúncio para remover.");
    return;
  }

  if (await tableExists("Transaction")) {
    const { data: transactions, error: txListError } = await supabase
      .from("Transaction")
      .select("id");
    if (txListError) throw new Error(txListError.message);

    const transactionIds = (transactions ?? []).map((row) => row.id);
    await deleteByTransactionIds("Review", transactionIds);
    await deleteByTransactionIds("SupportTicket", transactionIds);
    await deleteAll("Transaction");
  }

  const { data: listingConversations, error: convListError } = await supabase
    .from("Conversation")
    .select("id")
    .not("listingId", "is", null);
  if (convListError && !convListError.message.includes("listingId")) {
    throw new Error(convListError.message);
  }

  const conversationIds = (listingConversations ?? []).map((row) => row.id);
  if (conversationIds.length > 0) {
    const { error: messageError } = await supabase
      .from("Message")
      .delete()
      .in("conversationId", conversationIds);
    if (messageError) throw new Error(`Message: ${messageError.message}`);

    const { error: convDeleteError } = await supabase
      .from("Conversation")
      .delete()
      .in("id", conversationIds);
    if (convDeleteError) throw new Error(`Conversation: ${convDeleteError.message}`);
  }

  await deleteAll("ListingImage");
  await deleteAll("Listing");

  const after = {
    listings: await countRows("Listing"),
    images: await countRows("ListingImage"),
  };

  console.log("[clear-listings] Depois:", after);
  console.log("[clear-listings] Anúncios removidos com sucesso.");
}

main().catch((err) => {
  console.error("[clear-listings] Falha:", err instanceof Error ? err.message : err);
  process.exit(1);
});
