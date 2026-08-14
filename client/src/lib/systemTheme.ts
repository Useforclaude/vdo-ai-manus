export type SystemConsoleTheme = "light" | "dark";

export const SYSTEM_CONSOLE_THEME_KEY = "cineflow-system-console-theme";

export function parseSystemConsoleTheme(value: string | null | undefined): SystemConsoleTheme {
  return value === "dark" ? "dark" : "light";
}
