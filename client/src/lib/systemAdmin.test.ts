import { describe, expect, it } from "vitest";
import { shouldEnableAdminQuery } from "./systemAdmin";

describe("shouldEnableAdminQuery", () => {
  it("does not enable protected requests before access resolves", () => {
    expect(shouldEnableAdminQuery(undefined)).toBe(false);
  });

  it("does not enable protected requests for a locked console", () => {
    expect(shouldEnableAdminQuery(false)).toBe(false);
  });

  it("enables protected requests only after administrator access is granted", () => {
    expect(shouldEnableAdminQuery(true)).toBe(true);
  });
});
