import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";

const authRoutes = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: "auth",
});

authRoutes.post("/register", authLimiter, (req, res, next) =>
  authController.register(req, res, next)
);
authRoutes.post("/login", authLimiter, (req, res, next) =>
  authController.login(req, res, next)
);
authRoutes.get("/me", requireAuth, (req, res, next) =>
  authController.me(req, res, next)
);
authRoutes.patch("/profile", requireAuth, (req, res, next) =>
  authController.updateProfile(req, res, next)
);

export { authRoutes };
