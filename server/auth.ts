import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session && (req.session as any).authenticated === true) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
}
