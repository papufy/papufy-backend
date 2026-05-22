import { Router } from "express";
import { listingsController } from "../controllers/listings.controller";
import { requireAuth } from "../middleware/auth";
import { optionalAuth } from "../middleware/optionalAuth";
import { uploadListingImages } from "../middleware/upload";

export const listingsRoutes = Router();

listingsRoutes.get("/", (req, res, next) =>
  listingsController.list(req, res, next)
);

listingsRoutes.get("/:id", optionalAuth, (req, res, next) =>
  listingsController.getById(req, res, next)
);

listingsRoutes.post(
  "/",
  requireAuth,
  uploadListingImages,
  (req, res, next) => listingsController.create(req, res, next)
);
