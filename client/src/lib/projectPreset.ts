import { z } from "zod";

export const PROJECT_PRESET_FORMAT = "cineflow-project-preset" as const;
export const PROJECT_PRESET_VERSION = 1 as const;

export type ProjectPresetClip = {
  sourceName: string;
  occurrence: number;
  trimStartMs: number | null;
  trimEndMs: number | null;
};

export type ProjectPreset = {
  format: typeof PROJECT_PRESET_FORMAT;
  version: typeof PROJECT_PRESET_VERSION;
  exportedAt: string;
  command: string;
  subtitleStyle: {
    font: "Noto Sans Thai" | "Arial" | "Inter";
    size: "small" | "medium" | "large";
    position: "bottom" | "middle" | "top";
  };
  clips: ProjectPresetClip[];
};

const nullableMilliseconds = z.number().int().min(0).nullable();

const projectPresetSchema = z.object({
  format: z.literal(PROJECT_PRESET_FORMAT),
  version: z.literal(PROJECT_PRESET_VERSION),
  exportedAt: z.string().datetime(),
  command: z.string().max(4000),
  subtitleStyle: z.object({
    font: z.enum(["Noto Sans Thai", "Arial", "Inter"]),
    size: z.enum(["small", "medium", "large"]),
    position: z.enum(["bottom", "middle", "top"]),
  }),
  clips: z.array(z.object({
    sourceName: z.string().trim().min(1).max(255),
    occurrence: z.number().int().min(1).max(12),
    trimStartMs: nullableMilliseconds,
    trimEndMs: nullableMilliseconds,
  })).min(1).max(12),
}).strict();

export function buildProjectPreset(input: Omit<ProjectPreset, "format" | "version" | "exportedAt">): ProjectPreset {
  return {
    format: PROJECT_PRESET_FORMAT,
    version: PROJECT_PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    ...input,
  };
}

export function parseProjectPreset(value: unknown): ProjectPreset {
  return projectPresetSchema.parse(value);
}
