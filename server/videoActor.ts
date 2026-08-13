import { randomBytes } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import { getSessionCookieOptions } from "./_core/cookies";
import * as db from "./db";

export const GUEST_COOKIE_NAME = "cineflow_guest";
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const GUEST_COOKIE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type VideoActor = {
  userId: number;
  isGuest: boolean;
};

export async function resolveVideoActor(req: Request, res: Response, authenticatedUser?: { id: number } | null): Promise<VideoActor> {
  if (authenticatedUser) return { userId: authenticatedUser.id, isGuest: false };

  const cookies = parse(req.headers.cookie ?? "");
  let guestToken = cookies[GUEST_COOKIE_NAME];
  if (!guestToken || !GUEST_TOKEN_PATTERN.test(guestToken)) {
    guestToken = randomBytes(32).toString("base64url");
    res.cookie(GUEST_COOKIE_NAME, guestToken, {
      ...getSessionCookieOptions(req),
      sameSite: "lax",
      maxAge: GUEST_COOKIE_AGE_MS,
    });
  }

  const guest = await db.getOrCreateGuestUser(guestToken);
  return { userId: guest.id, isGuest: true };
}
