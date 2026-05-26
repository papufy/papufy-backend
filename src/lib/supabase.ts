import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { env } from "../config/env";
import type { Database } from "../types/database";

/** Node 20 não expõe WebSocket nativo; exigido pelo @supabase/realtime-js. */
export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      // ws no Node 20; tipos do realtime-js não batem com @types/ws
      transport: WebSocket as never,
    },
  }
);
