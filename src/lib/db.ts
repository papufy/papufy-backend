import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export { supabase };

export function newId(): string {
  return crypto.randomUUID();
}

/** Passe o tipo da linha (ex.: Tables<"Job">), não `T | null`. */
export function assertNoError<R>(
  result: { data: R | null; error: PostgrestError | null },
  message?: string
): R {
  if (result.error) {
    const err = new Error(message ?? result.error.message);
    (err as Error & { statusCode?: number }).statusCode = 500;
    throw err;
  }
  if (result.data === null || result.data === undefined) {
    const err = new Error(message ?? "Registro não encontrado.");
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  return result.data;
}
