import { describe, expect, it } from "vitest";
import { parseSystemConsoleTheme, SYSTEM_CONSOLE_THEME_KEY } from "./systemTheme";

describe("system console theme", () => {
  it("keeps a valid persisted dark preference", () => {
    expect(parseSystemConsoleTheme("dark")).toBe("dark");
  });

  it("falls back to light for missing or malformed values", () => {
    expect(parseSystemConsoleTheme(null)).toBe("light");
    expect(parseSystemConsoleTheme("midnight")).toBe("light");
    expect(SYSTEM_CONSOLE_THEME_KEY).toBe("cineflow-system-console-theme");
  });
});
