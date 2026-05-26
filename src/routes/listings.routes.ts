import { Router } from "express";
import { listingsController } from "../controllers/listings.controller";
import { requireAuth } from "../middleware/auth";
import { optionalAuth } from "../middleware/optionalAuth";
import {
  uploadListingImages,
  validateListingImagesUpload,
} from "../middleware/upload";
import { validateResourceId } from "../middleware/validateId";
import { rateLimit } from "../middleware/rateLimit";

export const listingsRoutes = Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: "listings-write",
});

listingsRoutes.get("/", (req, res, next) =>
  listingsController.list(req, res, next)
);

listingsRoutes.get("/:id", validateResourceId(), optionalAuth, (req, res, next) =>
  listingsController.getById(req, res, next)
);

listingsRoutes.post(
  "/",
  requireAuth,
  writeLimiter,
  uploadListingImages,
  validateListingImagesUpload,
  (req, res, next) => listingsController.create(req, res, next)
);
