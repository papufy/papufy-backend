import type { NextFunction, Request, Response } from "express";
import { userProfileService } from "../services/userProfile.service";

export class UserProfileController {
  async getPublicProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.userId);
      const result = await userProfileService.getPublicProfile(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const userProfileController = new UserProfileController();
