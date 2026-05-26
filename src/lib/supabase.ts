import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import type { Database } from "../types/database";

export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);
