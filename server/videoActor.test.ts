import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getOrCreateGuestUser: vi.fn() }));

vi.mock("./db", () => ({ getOrCreateGuestUser: mocks.getOrCreateGuestUser }));

import { GUEST_COOKIE_NAME, resolveVideoActor } from "./videoActor";

function request(cookie?: string) {
  return { protocol: "https", headers: cookie ? { cookie } : {} } as any;
}

function response() {
  return { cookie: vi.fn() } as any;
}

describe("resolveVideoActor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getOrCreateGuestUser.mockResolvedValue({ id: 101 });
  });

  it("creates an opaque guest cookie and guest owner when no user session exists", async () => {
    const res = response();
    await expect(resolveVideoActor(request(), res, null)).resolves.toEqual({ userId: 101, isGuest: true });
    expect(res.cookie).toHaveBeenCalledWith(GUEST_COOKIE_NAME, expect.stringMatching(/^[A-Za-z0-9_-]{40,64}$/), expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: true }));
    expect(mocks.getOrCreateGuestUser).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{40,64}$/));
  });

  it("reuses a valid guest cookie without replacing it", async () => {
    const token = "a".repeat(43);
    const res = response();
    await expect(resolveVideoActor(request(`${GUEST_COOKIE_NAME}=${token}`), res, null)).resolves.toEqual({ userId: 101, isGuest: true });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(mocks.getOrCreateGuestUser).toHaveBeenCalledWith(token);
  });

  it("uses a signed-in account when one is available", async () => {
    const res = response();
    await expect(resolveVideoActor(request(), res, { id: 7 })).resolves.toEqual({ userId: 7, isGuest: false });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(mocks.getOrCreateGuestUser).not.toHaveBeenCalled();
  });
});
