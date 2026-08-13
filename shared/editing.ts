export const EDIT_OPERATION_TYPES = [
  "remove_silence",
  "trim",
  "crop_16_9",
  "generate_subtitles",
] as const;

export type EditOperationType = (typeof EDIT_OPERATION_TYPES)[number];

export type EditOperation = {
  type: EditOperationType;
  startSeconds?: number;
  endSeconds?: number;
};

export type EditPlan = {
  sourceLanguage: "th" | "en" | "mixed" | "unknown";
  summary: string;
  operations: EditOperation[];
};
