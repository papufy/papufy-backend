import express from "express";
import cors from "cors";
import path from "path";
import { corsOptions } from "./config/cors";
import { env } from "./config/env";
import { authRoutes } from "./routes/auth.routes";
import { chatRoutes } from "./routes/chat.routes";
import { jobsRoutes } from "./routes/jobs.routes";
import { listingsRoutes } from "./routes/listings.routes";
import { userRoutes } from "./routes/user.routes";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/securityHeaders";
import { rateLimit } from "./middleware/rateLimit";

export function createApp() {
  const app = express();

  app.use(securityHeaders);
  app.set("trust proxy", 1);
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "100kb" }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      keyPrefix: "global",
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "papufy-api", env: env.NODE_ENV });
  });

  app.use(
    "/uploads",
    express.static(path.join(env.uploadDir), {
      maxAge: env.isProduction ? "7d" : 0,
    })
  );

  app.use("/auth", authRoutes);
  app.use("/listings", listingsRoutes);
  app.use("/user", userRoutes);
  app.use("/jobs", jobsRoutes);
  app.use("/chat", chatRoutes);

  app.use(errorHandler);

  return app;
}
