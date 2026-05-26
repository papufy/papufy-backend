import { Router } from "express";
import { jobsController } from "../controllers/jobs.controller";
import { requireAuth } from "../middleware/auth";
import { optionalAuth } from "../middleware/optionalAuth";
import { validateResourceId } from "../middleware/validateId";
import { rateLimit } from "../middleware/rateLimit";

const jobsRoutes = Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: "jobs-write",
});

jobsRoutes.get("/categories/list", (req, res) =>
  jobsController.categories(req, res)
);

jobsRoutes.get("/mine", requireAuth, (req, res, next) =>
  jobsController.listMine(req, res, next)
);

jobsRoutes.get("/", (req, res, next) => jobsController.list(req, res, next));

jobsRoutes.get(
  "/:id/interests",
  validateResourceId(),
  requireAuth,
  (req, res, next) => jobsController.listInterests(req, res, next)
);

jobsRoutes.get("/:id", validateResourceId(), optionalAuth, (req, res, next) =>
  jobsController.getById(req, res, next)
);

jobsRoutes.post("/", requireAuth, writeLimiter, (req, res, next) =>
  jobsController.create(req, res, next)
);

jobsRoutes.patch("/:id", validateResourceId(), requireAuth, writeLimiter, (req, res, next) =>
  jobsController.update(req, res, next)
);

jobsRoutes.patch("/:id/close", validateResourceId(), requireAuth, (req, res, next) =>
  jobsController.close(req, res, next)
);

jobsRoutes.patch("/:id/reopen", validateResourceId(), requireAuth, (req, res, next) =>
  jobsController.reopen(req, res, next)
);

jobsRoutes.delete("/:id", validateResourceId(), requireAuth, (req, res, next) =>
  jobsController.remove(req, res, next)
);

jobsRoutes.post(
  "/:id/interest",
  validateResourceId(),
  requireAuth,
  writeLimiter,
  (req, res, next) => jobsController.registerInterest(req, res, next)
);

export { jobsRoutes };
