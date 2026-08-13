export const SUBTITLE_PRESETS = {
  thai_standard: {
    label: "Thai Standard",
    description: "อ่านง่ายสำหรับวิดีโอทั่วไป",
    style: { font: "Noto Sans Thai", size: "medium", position: "bottom" },
  },
  thai_story: {
    label: "Thai Story",
    description: "ตัวใหญ่เด่น เหมาะกับคลิปแนวเล่าเรื่อง",
    style: { font: "Noto Sans Thai", size: "large", position: "middle" },
  },
  thai_minimal: {
    label: "Thai Minimal",
    description: "เรียบเล็ก ชิดขอบล่างของภาพ",
    style: { font: "Noto Sans Thai", size: "small", position: "bottom" },
  },
} as const;

export type SubtitlePresetId = keyof typeof SUBTITLE_PRESETS | "custom";
export type SubtitleStyle = {
  font: "Noto Sans Thai" | "Arial" | "Inter";
  size: "small" | "medium" | "large";
  position: "bottom" | "middle" | "top";
};

export function subtitleStyleForPreset(preset: Exclude<SubtitlePresetId, "custom">): SubtitleStyle {
  return SUBTITLE_PRESETS[preset].style;
}
