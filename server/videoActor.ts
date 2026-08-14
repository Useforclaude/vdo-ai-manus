import { randomBytes } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import * as db from "./db";
import { runtimeConfig } from "./runtimeConfig";

export const GUEST_COOKIE_NAME = "cineflow_guest";
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const GUEST_COOKIE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type VideoActor = {
  userId: number;
  isGuest: boolean;
};

export async function resolveVideoActor(req: Request, res: Response, authenticatedUser?: { id: number } | null): Promise<VideoActor> {
  // Cineflow is intentionally a guest-first tool. The browser may still carry
  // a preview or Manus session token, so video requests explicitly opt into
  // their own cookie-scoped actor to keep upload, job creation, and processing
  // within one browser session.
  const forceGuest = req.get("x-cineflow-guest") === "1";
  if (authenticatedUser && !forceGuest) return { userId: authenticatedUser.id, isGuest: false };

  const cookies = parse(req.headers.cookie ?? "");
  let guestToken = cookies[GUEST_COOKIE_NAME];
  if (!guestToken || !GUEST_TOKEN_PATTERN.test(guestToken)) {
    guestToken = randomBytes(32).toString("base64url");
    res.cookie(GUEST_COOKIE_NAME, guestToken, {
      httpOnly: true,
      secure: runtimeConfig.app.cookieSecure || req.secure || req.get("x-forwarded-proto") === "https",
      path: "/",
      sameSite: "lax",
      maxAge: GUEST_COOKIE_AGE_MS,
    });
  }

  const guest = await db.getOrCreateGuestUser(guestToken);
  return { userId: guest.id, isGuest: true };
}
