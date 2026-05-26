import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { corsOptions } from "./config/cors";
import { env } from "./config/env";
import { supabase } from "./lib/supabase";
import { authRoutes } from "./routes/auth.routes";
import { chatRoutes } from "./routes/chat.routes";
import { jobsRoutes } from "./routes/jobs.routes";
import { listingsRoutes } from "./routes/listings.routes";
import { paymentsRoutes } from "./routes/payments.routes";
import { userRoutes } from "./routes/user.routes";
import { errorHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/securityHeaders";
import { rateLimit } from "./middleware/rateLimit";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: env.isProduction ? undefined : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(securityHeaders);
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

  app.get("/health/db", async (_req, res) => {
    try {
      const { error } = await supabase.from("User").select("id").limit(1);
      if (error) throw error;
      res.json({ status: "ok", database: "connected" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha ao conectar no banco.";
      console.error("[health/db]", message);
      res.status(503).json({ status: "error", database: "disconnected", message });
    }
  });

  app.use(
    "/uploads",
    express.static(path.join(env.uploadDir), {
      maxAge: env.isProduction ? "7d" : 0,
      dotfiles: "deny",
      index: false,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".pdf") {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", "inline");
        } else if (ext === ".jpg" || ext === ".jpeg") {
          res.setHeader("Content-Type", "image/jpeg");
        } else if (ext === ".png") {
          res.setHeader("Content-Type", "image/png");
        }
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    })
  );

  app.use("/auth", authRoutes);
  app.use("/listings", listingsRoutes);
  app.use("/user", userRoutes);
  app.use("/jobs", jobsRoutes);
  app.use("/chat", chatRoutes);
  if (env.paymentsEnabled) {
    app.use("/payments", paymentsRoutes);
  }

  app.use(errorHandler);

  return app;
}
