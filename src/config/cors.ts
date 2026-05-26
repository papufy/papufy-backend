import type { CorsOptions } from "cors";
import { env, isCorsOriginAllowed } from "./env";

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
};
