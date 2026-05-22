import type { CorsOptions } from "cors";
import { env, isCorsOriginAllowed } from "./env";

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS bloqueado para origem: ${origin}`));
  },
  credentials: true,
};
