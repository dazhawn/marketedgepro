import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1. Valid session (browser login)
  if (req.session && (req.session as any).authenticated === true) {
    return next();
  }

  // 2. Webhook secret via header or query param (allows settings page & morning brief
  //    to work without an active session — useful on mobile / after redeploy)
  const webhookSecret = process.env.SESSION_SECRET;
  if (webhookSecret) {
    const headerSecret = req.headers["x-webhook-secret"] as string | undefined;
    const querySecret = req.query.secret as string | undefined;
    if (headerSecret === webhookSecret || querySecret === webhookSecret) {
      return next();
    }
  }

  return res.status(401).json({ message: "Unauthorized" });
}
