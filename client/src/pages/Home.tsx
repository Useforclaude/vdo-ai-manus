import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Captions,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  FileVideo2,
  Film,
  FolderOpen,
  Languages,
  Loader2,
  PencilLine,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { SUBTITLE_PRESETS, type SubtitlePresetId } from "@shared/subtitles";
import { extractWaveformPeaks, type WaveformPeaks } from "@/lib/waveform";
import { buildProjectPreset, parseProjectPreset } from "@/lib/projectPreset";

type Project = {
  id: number;
  title: string;
  sourceFileName: string;
  sourceUrl: string;
  sourceBytes: number;
  expiresAt?: Date | null;
};

type Clip = {
  id: number;
  sortOrder: number;
  originalName: string;
  storageUrl: string;
  sizeBytes: number;
  trimStartMs?: number | null;
  trimEndMs?: number | null;
};

type CustomSubtitlePreset = {
  id: number;
  name: string;
  font: "Noto Sans Thai" | "Arial" | "Inter";
  size: "small" | "medium" | "large";
  position: "bottom" | "middle" | "top";
};

type TimelineSnapshot = {
  clipIds: number[];
  trims: Array<{ clipId: number; trimStartMs: number | null; trimEndMs: number | null }>;
};

type SilencePreview = {
  hasAudio: boolean;
  sourceDurationMs: number;
  timelineDurationMs: number;
  removedDurationMs: number;
  silenceRanges: Array<{ startMs: number; endMs: number; durationMs: number }>;
};

const prompts = ["ตัดช่วงเงียบทั้งหมด", "สร้างซับไตเติลอัตโนมัติ", "Crop video to 16:9", "Keep the first 30 seconds"];
const subtitleCommand = /เงียบ|silence|dead air/;
const subtitleRequest = /ซับ|subtitle|srt|caption/i;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: string) {
  return { queued: "รอเริ่มงาน", processing: "กำลังประมวลผล", complete: "เสร็จแล้ว", failed: "ต้องตรวจสอบ" }[status] ?? status;
}

function statusClass(status: string) {
  return {
    queued: "bg-amber-100 text-amber-800 ring-amber-200",
    processing: "bg-sky-100 text-sky-800 ring-sky-200",
    complete: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    failed: "bg-rose-100 text-rose-800 ring-rose-200",
  }[status] ?? "bg-stone-100 text-stone-700 ring-stone-200";
}

function planLabel(type: string) {
  return {
    remove_silence: "ตัดช่วงเงียบ",
    trim: "ตัดความยาว",
    crop_16_9: "ครอป 16:9",
    generate_subtitles: "สร้างซับไตเติล",
  }[type] ?? type;
}

function videoApiHeaders(headers: Record<string, string> = {}) {
  return { "x-cineflow-guest": "1", ...headers };
}

export default function Home() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [temporaryPreview, setTemporaryPreview] = useState("");
  const [command, setCommand] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isProjectLibraryOpen, setIsProjectLibraryOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);
  const [waveformPeaks, setWaveformPeaks] = useState<WaveformPeaks>([]);
  const [waveformStatus, setWaveformStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [waveformTrimTarget, setWaveformTrimTarget] = useState<"start" | "end">("start");
  const [subtitlePreset, setSubtitlePreset] = useState<SubtitlePresetId>("thai_standard");
  const [subtitleStyle, setSubtitleStyle] = useState<{
    font: "Noto Sans Thai" | "Arial" | "Inter";
    size: "small" | "medium" | "large";
    position: "bottom" | "middle" | "top";
  }>({ font: "Noto Sans Thai", size: "medium", position: "bottom" });
  const [newPresetName, setNewPresetName] = useState("");
  const [selectedCustomPresetId, setSelectedCustomPresetId] = useState<number | null>(null);
  const [customPresetDirty, setCustomPresetDirty] = useState(false);
  const [timelineHistory, setTimelineHistory] = useState<TimelineSnapshot[]>([]);
  const [timelineRedoHistory, setTimelineRedoHistory] = useState<TimelineSnapshot[]>([]);
  const [silencePreview, setSilencePreview] = useState<SilencePreview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectPresetInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const projectsQuery = trpc.video.listProjects.useQuery();
  const searchedProjectsQuery = trpc.video.listProjects.useQuery({ search: projectSearch.trim() || undefined }, { enabled: isProjectLibraryOpen });
  const project = useMemo(() => (projectsQuery.data ?? []).find(item => item.id === selectedProjectId) as Project | undefined, [projectsQuery.data, selectedProjectId]);
  const clipsQuery = trpc.video.listClips.useQuery({ projectId: selectedProjectId ?? 0 }, { enabled: Boolean(selectedProjectId) });
  const jobsQuery = trpc.video.listJobs.useQuery(undefined, {
    refetchInterval: query => query.state.data?.some(job => job.status === "queued" || job.status === "processing") ? 2000 : false,
  });
  const createJob = trpc.video.createJob.useMutation();
  const reorderClips = trpc.video.reorderClips.useMutation();
  const removeClip = trpc.video.removeClip.useMutation();
  const deleteProject = trpc.video.deleteProject.useMutation();
  const deleteJob = trpc.video.deleteJob.useMutation();
  const setRetention = trpc.video.setProjectRetention.useMutation();
  const renameProject = trpc.video.renameProject.useMutation();
  const setClipTrim = trpc.video.setClipTrim.useMutation();
  const duplicateProject = trpc.video.duplicateProject.useMutation();
  const previewClipSilences = trpc.video.previewClipSilences.useMutation();
  const customPresetsQuery = trpc.video.listCustomSubtitlePresets.useQuery();
  const createCustomSubtitlePreset = trpc.video.createCustomSubtitlePreset.useMutation();
  const updateCustomSubtitlePreset = trpc.video.updateCustomSubtitlePreset.useMutation();
  const deleteCustomSubtitlePreset = trpc.video.deleteCustomSubtitlePreset.useMutation();
  const clips = clipsQuery.data ?? [];
  const customPresets = (customPresetsQuery.data ?? []) as CustomSubtitlePreset[];
  const selectedClip = clips.find(clip => clip.id === selectedClipId);
  const editableDurationMs = Math.max(1_000, Math.min(180_000, Math.round(previewDurationMs || selectedClip?.trimEndMs || 180_000)));
  const previewUrl = temporaryPreview || selectedClip?.storageUrl || "";
  const recentJobs = useMemo(() => jobsQuery.data?.slice(0, 6) ?? [], [jobsQuery.data]);
  const activeJob = useMemo(() => recentJobs.find(job => job.status === "queued" || job.status === "processing"), [recentJobs]);
  const retentionValue = useMemo(() => {
    if (!project?.expiresAt) return "keep";
    return new Date(project.expiresAt).getTime() - Date.now() <= 14 * 24 * 60 * 60 * 1000 ? "seven_days" : "thirty_days";
  }, [project?.expiresAt]);
  const requestsSubtitles = subtitleRequest.test(command);

  useEffect(() => {
    const available = projectsQuery.data ?? [];
    if (!available.some(item => item.id === selectedProjectId)) setSelectedProjectId(available[0]?.id ?? null);
  }, [projectsQuery.data, selectedProjectId]);

  useEffect(() => {
    if (!clips.some(clip => clip.id === selectedClipId)) setSelectedClipId(clips[0]?.id ?? null);
  }, [clips, selectedClipId]);

  useEffect(() => {
    setPreviewDurationMs(0);
    setTrimStartMs(selectedClip?.trimStartMs ?? 0);
    setTrimEndMs(selectedClip?.trimEndMs ?? 0);
  }, [selectedClip?.id, selectedClip?.trimStartMs, selectedClip?.trimEndMs]);

  useEffect(() => {
    setTimelineHistory([]);
    setTimelineRedoHistory([]);
  }, [project?.id]);

  useEffect(() => {
    setSilencePreview(null);
  }, [selectedClip?.id, selectedClip?.trimStartMs, selectedClip?.trimEndMs]);

  useEffect(() => {
    const controller = new AbortController();
    if (!selectedClip?.storageUrl) {
      setWaveformPeaks([]);
      setWaveformStatus("idle");
      return () => controller.abort();
    }

    setWaveformPeaks([]);
    setWaveformStatus("loading");
    void extractWaveformPeaks(selectedClip.storageUrl, 96, controller.signal)
      .then(peaks => {
        if (controller.signal.aborted) return;
        setWaveformPeaks(peaks);
        setWaveformStatus(peaks.length ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setWaveformStatus("unavailable");
      });

    return () => controller.abort();
  }, [selectedClip?.id, selectedClip?.storageUrl]);

  useEffect(() => {
    setProjectTitleDraft(project?.title ?? "");
  }, [project?.id, project?.title]);

  useEffect(() => () => {
    if (temporaryPreview.startsWith("blob:")) URL.revokeObjectURL(temporaryPreview);
  }, [temporaryPreview]);

  async function refreshVideoData() {
    await Promise.all([
      utils.video.listProjects.invalidate(),
      utils.video.listClips.invalidate(),
      utils.video.listJobs.invalidate(),
      utils.video.listCustomSubtitlePresets.invalidate(),
    ]);
  }

  function captureTimeline(sourceClips: Clip[] = clips): TimelineSnapshot {
    return {
      clipIds: sourceClips.map(clip => clip.id),
      trims: sourceClips.map(clip => ({ clipId: clip.id, trimStartMs: clip.trimStartMs ?? null, trimEndMs: clip.trimEndMs ?? null })),
    };
  }

  function rememberTimelineChange(snapshot: TimelineSnapshot) {
    setTimelineHistory(history => [...history.slice(-19), snapshot]);
    setTimelineRedoHistory([]);
  }

  async function restoreTimeline(snapshot: TimelineSnapshot) {
    if (!project) throw new Error("Video project was not found");
    const current = captureTimeline(await utils.video.listClips.fetch({ projectId: project.id }) as Clip[]);
    const hasSameOrder = current.clipIds.length === snapshot.clipIds.length && current.clipIds.every((clipId, index) => clipId === snapshot.clipIds[index]);
    if (!hasSameOrder) await reorderClips.mutateAsync({ projectId: project.id, clipIds: snapshot.clipIds });
    for (const savedTrim of snapshot.trims) {
      const currentTrim = current.trims.find(trim => trim.clipId === savedTrim.clipId);
      if (!currentTrim || currentTrim.trimStartMs !== savedTrim.trimStartMs || currentTrim.trimEndMs !== savedTrim.trimEndMs) {
        await setClipTrim.mutateAsync({ projectId: project.id, ...savedTrim });
      }
    }
    await utils.video.listClips.invalidate({ projectId: project.id });
    return current;
  }

  async function undoTimeline() {
    const previous = timelineHistory.at(-1);
    if (!previous) return;
    try {
      const current = await restoreTimeline(previous);
      setTimelineHistory(history => history.slice(0, -1));
      setTimelineRedoHistory(history => [...history.slice(-19), current]);
      toast.success("ย้อนการเปลี่ยนแปลง timeline แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถย้อน timeline ได้");
    }
  }

  async function redoTimeline() {
    const next = timelineRedoHistory.at(-1);
    if (!next) return;
    try {
      const current = await restoreTimeline(next);
      setTimelineRedoHistory(history => history.slice(0, -1));
      setTimelineHistory(history => [...history.slice(-19), current]);
      toast.success("ทำซ้ำการเปลี่ยนแปลง timeline แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถทำซ้ำ timeline ได้");
    }
  }

  async function loadSilencePreview() {
    if (!project || !selectedClip) return;
    try {
      const preview = await previewClipSilences.mutateAsync({ projectId: project.id, clipId: selectedClip.id });
      setSilencePreview(preview);
      if (!preview.hasAudio) toast.info("คลิปนี้ไม่มีแทร็กเสียงให้ตรวจช่วงเงียบ");
      else toast.success(preview.silenceRanges.length ? `พบช่วงเงียบ ${preview.silenceRanges.length} ช่วง` : "ไม่พบช่วงเงียบตามเกณฑ์ที่ตั้งไว้");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถตรวจช่วงเงียบได้");
    }
  }

  function exportProjectPreset() {
    if (!project || !clips.length) return;
    const occurrences = new Map<string, number>();
    const preset = buildProjectPreset({
      command,
      subtitleStyle,
      clips: clips.map(clip => {
        const occurrence = (occurrences.get(clip.originalName) ?? 0) + 1;
        occurrences.set(clip.originalName, occurrence);
        return { sourceName: clip.originalName, occurrence, trimStartMs: clip.trimStartMs ?? null, trimEndMs: clip.trimEndMs ?? null };
      }),
    });
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.title.trim().replace(/[^a-z0-9ก-๙_-]+/gi, "-").replace(/^-|-$/g, "") || "cineflow"}-preset.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("ส่งออก preset โครงการแล้ว — ไฟล์วิดีโอไม่ได้รวมอยู่ในไฟล์นี้");
  }

  async function importProjectPreset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!project || !file) return;
    if (file.size > 100 * 1024) {
      toast.error("ไฟล์ preset ต้องมีขนาดไม่เกิน 100 KB");
      return;
    }
    try {
      const preset = parseProjectPreset(JSON.parse(await file.text()));
      if (preset.clips.length !== clips.length) throw new Error("จำนวนคลิปไม่ตรงกับโครงการที่เปิดอยู่");
      const clipsByName = new Map<string, Clip[]>();
      for (const clip of clips) clipsByName.set(clip.originalName, [...(clipsByName.get(clip.originalName) ?? []), clip]);
      const resolvedClips = preset.clips.map(saved => {
        const match = clipsByName.get(saved.sourceName)?.[saved.occurrence - 1];
        if (!match) throw new Error(`ไม่พบคลิป “${saved.sourceName}” ในลำดับที่ preset ระบุ`);
        return { clip: match, trimStartMs: saved.trimStartMs, trimEndMs: saved.trimEndMs };
      });
      if (!window.confirm("นำ preset นี้มาใช้กับคำสั่ง รูปแบบซับ ลำดับคลิป และจุด trim ของโครงการปัจจุบันหรือไม่?")) return;
      const before = captureTimeline();
      const nextOrder = resolvedClips.map(item => item.clip.id);
      const orderChanged = nextOrder.some((clipId, index) => clips[index]?.id !== clipId);
      if (orderChanged) await reorderClips.mutateAsync({ projectId: project.id, clipIds: nextOrder });
      for (const saved of resolvedClips) {
        const current = clips.find(clip => clip.id === saved.clip.id);
        if (current && ((current.trimStartMs ?? null) !== saved.trimStartMs || (current.trimEndMs ?? null) !== saved.trimEndMs)) {
          await setClipTrim.mutateAsync({ projectId: project.id, clipId: saved.clip.id, trimStartMs: saved.trimStartMs, trimEndMs: saved.trimEndMs });
        }
      }
      setCommand(preset.command);
      setSubtitlePreset("custom");
      setSubtitleStyle(preset.subtitleStyle);
      setSelectedCustomPresetId(null);
      setNewPresetName("");
      setCustomPresetDirty(false);
      await utils.video.listClips.invalidate({ projectId: project.id });
      rememberTimelineChange(before);
      toast.success("นำ preset โครงการมาใช้แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไฟล์ preset ไม่ถูกต้อง");
    }
  }

  async function uploadVideo(file: File) {
    if (!file.type.startsWith("video/")) {
      toast.error("โปรดเลือกไฟล์วิดีโอ");
      return;
    }
    if (file.size > 180 * 1024 * 1024) {
      toast.error("ไฟล์ต้องมีขนาดไม่เกิน 180 MB");
      return;
    }
    setIsUploading(true);
    setTemporaryPreview(URL.createObjectURL(file));
    try {
      const isAppending = Boolean(project);
      const response = await fetch(isAppending ? `/api/video-projects/${project?.id}/clips` : "/api/video-upload", {
        method: "POST",
        headers: videoApiHeaders({ "content-type": file.type || "video/mp4", "x-file-name": file.name, "x-file-type": file.type || "video/mp4" }),
        body: file,
      });
      const data = await response.json() as { project?: Project; clip?: Clip; error?: string };
      if (!response.ok || !data.clip) throw new Error(data.error ?? "Unable to upload video");
      if (data.project) setSelectedProjectId(data.project.id);
      setSelectedClipId(data.clip.id);
      setTemporaryPreview("");
      await refreshVideoData();
      toast.success(isAppending ? "เพิ่มคลิปเข้าลำดับตัดต่อแล้ว" : "อัปโหลดวิดีโอแล้ว พร้อมเพิ่มคลิปหรือสั่งงานได้เลย");
    } catch (error) {
      setTemporaryPreview("");
      toast.error(error instanceof Error ? error.message : "อัปโหลดวิดีโอไม่สำเร็จ");
    } finally {
      setIsUploading(false);
    }
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadVideo(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadVideo(file);
    event.target.value = "";
  }

  async function submitCommand() {
    if (!project) {
      toast.info("อัปโหลดวิดีโอก่อน แล้วจึงสั่งงานตัดต่อ");
      return;
    }
    if (!command.trim()) return;
    try {
      const job = await createJob.mutateAsync({
        projectId: project.id,
        command,
        subtitleStyle,
        subtitlePreset,
        customSubtitlePresetId: subtitlePreset === "custom" && selectedCustomPresetId && !customPresetDirty ? selectedCustomPresetId : undefined,
      });
      setCommand("");
      await utils.video.listJobs.invalidate();
      toast.success("วิเคราะห์คำสั่งแล้ว กำลังเริ่มงานตัดต่อ");
      void fetch(`/api/video-jobs/${job.id}/process`, { method: "POST", headers: videoApiHeaders() })
        .then(async response => {
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error ?? "Video processing failed");
          }
          await utils.video.listJobs.invalidate();
        })
        .catch(error => {
          toast.error(error instanceof Error ? error.message : "ประมวลผลวิดีโอไม่สำเร็จ");
          void utils.video.listJobs.invalidate();
        });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถสร้างงานตัดต่อได้");
    }
  }

  async function moveClip(clipId: number, direction: -1 | 1) {
    if (!project) return;
    const index = clips.findIndex(clip => clip.id === clipId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= clips.length) return;
    const orderedIds = clips.map(clip => clip.id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];
    const before = captureTimeline();
    try {
      await reorderClips.mutateAsync({ projectId: project.id, clipIds: orderedIds });
      await utils.video.listClips.invalidate({ projectId: project.id });
      rememberTimelineChange(before);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถเปลี่ยนลำดับคลิปได้");
    }
  }

  async function deleteSelectedClip(clipId: number) {
    if (!project) return;
    if (!window.confirm("นำคลิปนี้ออกจากลำดับตัดต่อหรือไม่? ไฟล์จะไม่สามารถเข้าถึงผ่าน Cineflow ได้อีก")) return;
    try {
      await removeClip.mutateAsync({ projectId: project.id, clipId });
      await utils.video.listClips.invalidate({ projectId: project.id });
      toast.success("นำคลิปออกจากโปรเจกต์แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถลบคลิปได้");
    }
  }

  async function deleteCurrentProject() {
    if (!project || !window.confirm("ลบโปรเจกต์และเพิกถอนการเข้าถึงคลิปกับผลลัพธ์ทั้งหมดหรือไม่? การกระทำนี้ย้อนกลับจากหน้าแอปไม่ได้")) return;
    try {
      await deleteProject.mutateAsync({ projectId: project.id });
      setSelectedProjectId(null);
      setSelectedClipId(null);
      await refreshVideoData();
      toast.success("ลบโปรเจกต์และเพิกถอนการเข้าถึงไฟล์แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถลบโปรเจกต์ได้");
    }
  }

  async function duplicateCurrentProject() {
    if (!project) return;
    try {
      const duplicated = await duplicateProject.mutateAsync({ projectId: project.id });
      await refreshVideoData();
      setSelectedProjectId(duplicated.id);
      setSelectedClipId(null);
      toast.success("ทำสำเนาโปรเจกต์แล้ว — ลองตัดต่ออีกเวอร์ชันได้ทันที");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถทำสำเนาโปรเจกต์ได้");
    }
  }

  async function saveClipTrim() {
    if (!project || !selectedClip) return;
    const normalizedEnd = trimEndMs || editableDurationMs;
    if (normalizedEnd <= trimStartMs) {
      toast.error("จุดสิ้นสุดต้องอยู่หลังจุดเริ่มต้น");
      return;
    }
    const before = captureTimeline();
    try {
      await setClipTrim.mutateAsync({ projectId: project.id, clipId: selectedClip.id, trimStartMs, trimEndMs: normalizedEnd });
      await utils.video.listClips.invalidate({ projectId: project.id });
      if (selectedClip.trimStartMs !== trimStartMs || selectedClip.trimEndMs !== normalizedEnd) rememberTimelineChange(before);
      toast.success("บันทึกช่วงคลิปสำหรับงานถัดไปแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกช่วงคลิปไม่สำเร็จ");
    }
  }

  async function saveProjectTitle() {
    if (!project || !projectTitleDraft.trim()) return;
    try {
      await renameProject.mutateAsync({ projectId: project.id, title: projectTitleDraft.trim() });
      await utils.video.listProjects.invalidate();
      toast.success("เปลี่ยนชื่อโปรเจกต์แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปลี่ยนชื่อโปรเจกต์ไม่สำเร็จ");
    }
  }

  function updateCustomStyle(update: Partial<typeof subtitleStyle>) {
    setSubtitlePreset("custom");
    setSubtitleStyle(current => ({ ...current, ...update }));
    setCustomPresetDirty(true);
  }

  function chooseSavedSubtitlePreset(preset: CustomSubtitlePreset) {
    setSubtitlePreset("custom");
    setSubtitleStyle({ font: preset.font, size: preset.size, position: preset.position });
    setSelectedCustomPresetId(preset.id);
    setNewPresetName(preset.name);
    setCustomPresetDirty(false);
  }

  async function saveCustomSubtitlePreset() {
    const name = newPresetName.trim();
    if (!name) {
      toast.error("ตั้งชื่อ preset ก่อนบันทึก");
      return;
    }
    try {
      if (selectedCustomPresetId) {
        await updateCustomSubtitlePreset.mutateAsync({ presetId: selectedCustomPresetId, name, ...subtitleStyle });
        setCustomPresetDirty(false);
        toast.success("อัปเดต preset ซับแล้ว");
      } else {
        const saved = await createCustomSubtitlePreset.mutateAsync({ name, ...subtitleStyle });
        setSelectedCustomPresetId(saved.id);
        setCustomPresetDirty(false);
        toast.success("บันทึก preset ซับส่วนตัวแล้ว");
      }
      await utils.video.listCustomSubtitlePresets.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถบันทึก preset ซับได้");
    }
  }

  async function removeCustomSubtitlePreset(preset: CustomSubtitlePreset) {
    if (!window.confirm(`ลบ preset “${preset.name}” หรือไม่?`)) return;
    try {
      await deleteCustomSubtitlePreset.mutateAsync({ presetId: preset.id });
      if (selectedCustomPresetId === preset.id) {
        setSelectedCustomPresetId(null);
        setNewPresetName("");
        setCustomPresetDirty(false);
      }
      await utils.video.listCustomSubtitlePresets.invalidate();
      toast.success("ลบ preset ซับแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถลบ preset ซับได้");
    }
  }

  function setTrimFromWaveform(event: MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const selectedMs = Math.round((ratio * editableDurationMs) / 100) * 100;
    if (waveformTrimTarget === "start") {
      setTrimStartMs(Math.max(0, Math.min(selectedMs, (trimEndMs || editableDurationMs) - 500)));
    } else {
      setTrimEndMs(Math.min(editableDurationMs, Math.max(selectedMs, trimStartMs + 500)));
    }
  }

  function chooseSubtitlePreset(preset: SubtitlePresetId) {
    setSubtitlePreset(preset);
    setSelectedCustomPresetId(null);
    setNewPresetName("");
    setCustomPresetDirty(false);
    if (preset !== "custom") setSubtitleStyle(SUBTITLE_PRESETS[preset].style);
  }

  return (
    <div className="min-h-screen bg-[#f6f5f2] text-[#17201e]">
      <header className="border-b border-[#e7e4de] bg-[#fbfaf8]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 lg:px-10">
          <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#152b27] text-[#c5f165] shadow-[0_8px_22px_rgba(21,43,39,.18)]"><Film size={19} strokeWidth={1.8} /></div><div><p className="font-display text-[17px] font-semibold tracking-[-0.04em]">Cineflow</p><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77827f]">AI VIDEO STUDIO</p></div></div>
          <div className="hidden items-center gap-8 text-[13px] font-medium text-[#66716d] md:flex"><span className="text-[#18211f]">Editor</span><button onClick={() => setIsProjectLibraryOpen(true)} className="transition hover:text-[#18211f]">Clip library</button><span>Help</span></div>
          <div className="flex items-center gap-2 rounded-full border border-[#dfe5d9] bg-[#f3f8e8] px-3 py-2 text-[11px] font-semibold text-[#496935]"><span className="size-1.5 rounded-full bg-[#91bf3b]" /> Ready to edit</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-7 lg:px-10 lg:py-9">
        <section className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#53766a]"><span className="size-1.5 rounded-full bg-[#a5d83d]" /> AI-powered editing</p><h1 className="font-display text-3xl font-semibold tracking-[-0.055em] sm:text-[40px]">Make the cut. <span className="text-[#789c55]">Say the word.</span></h1><p className="mt-2 max-w-xl text-sm leading-6 text-[#67726e]">อัปโหลดคลิปสั้นหลายรายการ จัดลำดับ แล้วบอกสิ่งที่ต้องการด้วยภาษาไทยหรือ English. เราจะรวมเป็นไทม์ไลน์เดียวและทำตามคำสั่งที่ตรวจสอบได้</p><p className="mt-2 text-[11px] font-medium text-[#78827c]">เริ่มได้ทันที ไม่ต้อง Sign in — งานของคุณผูกกับเบราว์เซอร์นี้</p></div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e3e4df] bg-[#fbfaf8] px-4 py-3"><div className="grid size-8 place-items-center rounded-lg bg-[#eef6d9] text-[#6c9131]"><Sparkles size={15} /></div><div><p className="text-xs font-semibold">Thai + English commands</p><p className="text-[11px] text-[#7a8580]">multi-clip timelines</p></div></div>
        </section>

        {project && <section className="mb-5 rounded-2xl border border-[#dce5d5] bg-[#f8fbf4] px-4 py-3 shadow-[0_12px_36px_rgba(31,43,37,.04)]"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-lg bg-[#e8f3d8] text-[#597d3b]"><Clock3 size={15} /></div><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#648447]">Timeline tools</p><p className="text-[11px] text-[#6e7c73]">Undo/redo ใช้กับการเรียงคลิปและช่วง trim ที่บันทึกแล้ว</p></div></div><div className="flex flex-wrap items-center gap-2"><button aria-label="Undo timeline" onClick={() => void undoTimeline()} disabled={!timelineHistory.length || reorderClips.isPending || setClipTrim.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3e0ca] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#456145] transition hover:bg-[#eef6e7] disabled:cursor-not-allowed disabled:opacity-35"><RotateCcw size={13} /> Undo</button><button aria-label="Redo timeline" onClick={() => void redoTimeline()} disabled={!timelineRedoHistory.length || reorderClips.isPending || setClipTrim.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3e0ca] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#456145] transition hover:bg-[#eef6e7] disabled:cursor-not-allowed disabled:opacity-35"><RotateCw size={13} /> Redo</button>{selectedClip && <button aria-label="Preview silence" onClick={() => void loadSilencePreview()} disabled={previewClipSilences.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-[#244337] px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-[#315849] disabled:opacity-50">{previewClipSilences.isPending ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Preview silence</button>}</div></div>{selectedClip && <div className="mt-3 rounded-xl border border-[#e0e7d9] bg-white px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-semibold text-[#50694d]">{silencePreview ? silencePreview.hasAudio ? silencePreview.silenceRanges.length ? `พบ ${silencePreview.silenceRanges.length} ช่วงเงียบ — จะลบประมาณ ${(silencePreview.removedDurationMs / 1000).toFixed(1)} วินาที` : "ไม่พบช่วงเงียบตามเกณฑ์ของ Cineflow" : "คลิปนี้ไม่มีแทร็กเสียง" : "กด Preview silence เพื่อตรวจช่วงที่คำสั่ง “ตัดช่วงเงียบ” จะลบก่อน render"}</p>{silencePreview?.hasAudio && silencePreview.silenceRanges.length > 0 && <span className="text-[9px] font-medium text-[#88734b]">Preview only · ไฟล์ยังไม่ถูกเปลี่ยน</span>}</div>{silencePreview?.hasAudio && silencePreview.silenceRanges.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{silencePreview.silenceRanges.slice(0, 5).map(silence => <span key={`${silence.startMs}-${silence.endMs}`} className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-medium text-[#856b37]">{(silence.startMs / 1000).toFixed(1)}–{(silence.endMs / 1000).toFixed(1)}s</span>)}{silencePreview.silenceRanges.length > 5 && <span className="rounded-full bg-stone-100 px-2 py-1 text-[9px] font-medium text-[#758078]">+{silencePreview.silenceRanges.length - 5} ช่วง</span>}</div>}</div>}</section>}

        {project && <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-[#dce5d5] bg-white px-4 py-3 shadow-[0_12px_36px_rgba(31,43,37,.04)] sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#648447]">Project preset</p><p className="mt-0.5 text-[11px] leading-4 text-[#6e7c73]">บันทึกคำสั่ง รูปแบบซับ ลำดับคลิป และ trim ไว้ใช้กับชุดคลิปชื่อเดิม โดยไม่ส่งออกวิดีโอหรือ URL</p></div><div className="flex shrink-0 items-center gap-2"><input ref={projectPresetInputRef} aria-label="Import project preset" type="file" accept="application/json,.json" onChange={event => void importProjectPreset(event)} className="hidden" /><button onClick={() => projectPresetInputRef.current?.click()} disabled={reorderClips.isPending || setClipTrim.isPending} className="rounded-lg border border-[#d3e0ca] bg-[#f8fbf4] px-3 py-2 text-[10px] font-semibold text-[#496a4b] transition hover:bg-[#edf6e4] disabled:opacity-40">Import preset</button><button onClick={exportProjectPreset} disabled={!clips.length} className="inline-flex items-center gap-1.5 rounded-lg bg-[#244337] px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-[#315849] disabled:opacity-40"><Download size={12} /> Export preset</button></div></section>}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_390px]">
          <section className="overflow-hidden rounded-[24px] border border-[#dfdfd9] bg-[#1b2421] shadow-[0_20px_60px_rgba(31,43,37,.08)]">
            <div className="flex h-14 items-center justify-between border-b border-white/10 px-5 text-white"><div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#c4ef55]" /><span className="text-xs font-semibold">Timeline preview</span></div><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white/70">{clips.length} / 12 clips</span></div>
            <div className="relative aspect-video bg-[radial-gradient(circle_at_42%_30%,#405e50_0%,#25372f_35%,#141c19_78%)]">
              {previewUrl ? <video controls onLoadedMetadata={event => setPreviewDurationMs(Math.round(event.currentTarget.duration * 1000))} className="size-full object-contain" src={previewUrl} /> : <div className="absolute inset-0 grid place-items-center"><div className="text-center text-white"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-white/10 text-[#d0ef91]"><Play size={22} fill="currentColor" /></div><p className="text-sm font-medium">Your preview will appear here</p><p className="mt-1 text-xs text-white/55">Add up to 12 short clips</p></div></div>}
              {isUploading && <div className="absolute inset-0 grid place-items-center bg-[#14211dcc] backdrop-blur-sm"><div className="rounded-2xl bg-white px-5 py-4 text-center shadow-xl"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#5d8337]" /><p className="text-xs font-semibold text-[#17201e]">Uploading securely</p><p className="mt-1 text-[11px] text-[#68736f]">Saving to this browser session</p></div></div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1b2421] px-5 py-4"><div className="flex items-center gap-3 text-xs text-white/65"><FileVideo2 size={15} className="text-[#b9e65c]" /><span className="max-w-[360px] truncate">{selectedClip?.originalName || "No clip selected"}</span></div>{project && <div className="flex items-center gap-4"><button onClick={() => void duplicateCurrentProject()} disabled={duplicateProject.isPending} className="flex items-center gap-1.5 text-[11px] font-medium text-[#c5f165] transition hover:text-white disabled:opacity-50">{duplicateProject.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Copy size={14} />} Duplicate</button><button onClick={() => void deleteCurrentProject()} className="flex items-center gap-1.5 text-[11px] font-medium text-white/55 transition hover:text-white"><Trash2 size={14} /> Delete project</button></div>}</div>
          </section>

          <section className="rounded-[24px] border border-[#dfdfd9] bg-[#fbfaf8] p-5 shadow-[0_20px_60px_rgba(31,43,37,.05)]">
            <div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#779775]">01 / Source</p><h2 className="mt-1 font-display text-xl font-semibold tracking-[-.04em]">Build your timeline</h2></div><UploadCloud className="size-5 text-[#6f9a4d]" /></div>
            <button onClick={() => inputRef.current?.click()} onDragOver={event => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={onDrop} className={`group grid min-h-[132px] w-full place-items-center rounded-[18px] border border-dashed px-6 text-center transition ${isDragging ? "border-[#87b84b] bg-[#f2f9df]" : "border-[#cdd8cc] bg-[#f7f8f5] hover:border-[#8ab05d] hover:bg-[#f4f8ea]"}`}>
              <div><div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-white text-[#6d9846] shadow-sm transition group-hover:-translate-y-0.5"><Plus size={19} /></div><p className="text-sm font-semibold">{project ? "Add another clip" : "Drop first video here"}</p><p className="mt-1 text-[11px] leading-5 text-[#74807b]">MP4, MOV, WebM and more<br />Maximum 180 MB for the assembled project</p></div>
            </button>
            <input ref={inputRef} className="hidden" type="file" accept="video/*" onChange={onFileChange} />
            {project && <div className="mt-4 rounded-xl border border-[#e4e6e1] bg-white p-2.5"><label className="text-[10px] font-semibold text-[#728078]">PROJECT NAME<div className="mt-1.5 flex gap-2"><input aria-label="Project name" value={projectTitleDraft} maxLength={120} onChange={event => setProjectTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void saveProjectTitle(); }} className="min-w-0 flex-1 rounded-lg border border-[#dce3d8] bg-[#fbfcfa] px-2.5 py-2 text-xs font-medium outline-none focus:border-[#91b85e]" /><button aria-label="Save project name" onClick={() => void saveProjectTitle()} disabled={renameProject.isPending || !projectTitleDraft.trim() || projectTitleDraft.trim() === project.title} className="grid size-8 place-items-center rounded-lg bg-[#eaf3dd] text-[#557b35] transition hover:bg-[#deebcc] disabled:opacity-40">{renameProject.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PencilLine size={13} />}</button></div></label></div>}
            <div className="mt-4 max-h-[220px] space-y-2 overflow-y-auto pr-1">{clips.length ? clips.map((clip, index) => <div key={clip.id} className={`flex items-center gap-2 rounded-xl border p-2 transition ${clip.id === selectedClipId ? "border-[#9fc66d] bg-[#f2f8e9]" : "border-[#e3e6e0] bg-white"}`}><button onClick={() => setSelectedClipId(clip.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-[11px] font-semibold">{index + 1}. {clip.originalName}</p><p className="mt-0.5 text-[10px] text-[#7c8882]">{formatBytes(clip.sizeBytes)} · {clip.trimStartMs || clip.trimEndMs ? "trimmed" : "full clip"}</p></button><div className="flex items-center"><button aria-label="Move clip up" disabled={index === 0 || reorderClips.isPending} onClick={() => void moveClip(clip.id, -1)} className="rounded p-1 text-[#738079] hover:bg-white disabled:opacity-30"><ArrowUp size={13} /></button><button aria-label="Move clip down" disabled={index === clips.length - 1 || reorderClips.isPending} onClick={() => void moveClip(clip.id, 1)} className="rounded p-1 text-[#738079] hover:bg-white disabled:opacity-30"><ArrowDown size={13} /></button><button aria-label="Remove clip" disabled={clips.length === 1 || removeClip.isPending} onClick={() => void deleteSelectedClip(clip.id)} className="rounded p-1 text-[#a7605a] hover:bg-rose-50 disabled:opacity-30"><Trash2 size={13} /></button></div></div>) : <p className="rounded-xl border border-dashed border-[#d9ded7] px-4 py-5 text-center text-[11px] text-[#87918c]">เพิ่มคลิปแรกเพื่อเริ่มไทม์ไลน์</p>}</div>
            {selectedClip && <div className="mt-4 rounded-2xl border border-[#dce6d3] bg-[#f4f8ed] p-3.5"><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#648447]">Clip timeline</p><p className="mt-0.5 truncate text-[11px] font-semibold text-[#2e4439]">{selectedClip.originalName}</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[#647b6c]">{(editableDurationMs / 1000).toFixed(1)}s</span></div><div className="mb-3 rounded-xl border border-[#dbe6d2] bg-white p-2.5"><div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold text-[#456c3e]">AUDIO WAVEFORM</p><p className="mt-0.5 text-[9px] text-[#718178]">ความสูงมากคือเสียงเด่น ช่วยเล็งช่วงเงียบก่อนตัด</p></div><div className="flex rounded-lg bg-[#edf3e8] p-0.5 text-[9px] font-semibold"><button onClick={() => setWaveformTrimTarget("start")} className={`rounded-md px-2 py-1 transition ${waveformTrimTarget === "start" ? "bg-[#244337] text-white" : "text-[#63756b]"}`}>Set start</button><button onClick={() => setWaveformTrimTarget("end")} className={`rounded-md px-2 py-1 transition ${waveformTrimTarget === "end" ? "bg-[#244337] text-white" : "text-[#63756b]"}`}>Set end</button></div></div>{waveformStatus === "loading" ? <div className="grid h-16 place-items-center rounded-lg bg-[#f7faf4] text-[10px] font-medium text-[#6a7a70]"><span className="inline-flex items-center gap-2"><Loader2 className="size-3.5 animate-spin text-[#779f45]" /> Reading audio waveform</span></div> : waveformStatus === "ready" ? <button aria-label={`Waveform timeline: click to set ${waveformTrimTarget}`} onClick={setTrimFromWaveform} className="relative flex h-16 w-full items-center gap-px overflow-hidden rounded-lg bg-[#1d3129] px-1.5 focus:outline-none focus:ring-2 focus:ring-[#87ad52]">{waveformPeaks.map((peak, index) => <span key={index} className="relative z-10 min-w-0 flex-1 rounded-full bg-[#c5f165] transition-opacity" style={{ height: `${Math.max(10, peak * 92)}%` }} />)}<span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 bg-[#13231e]/65" style={{ width: `${(trimStartMs / editableDurationMs) * 100}%` }} /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 bg-[#13231e]/65" style={{ width: `${Math.max(0, 100 - ((trimEndMs || editableDurationMs) / editableDurationMs) * 100)}%` }} /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(trimStartMs / editableDurationMs) * 100}%` }} /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${((trimEndMs || editableDurationMs) / editableDurationMs) * 100}%` }} /></button> : <div className="grid h-16 place-items-center rounded-lg bg-[#f7faf4] px-3 text-center text-[10px] leading-4 text-[#708078]">ไม่พบเสียงที่อ่านได้ในคลิปนี้ — ยังตั้งช่วงตัดด้วย slider ด้านล่างได้</div>}</div><div className="space-y-3"><label className="block text-[10px] font-semibold text-[#61736a]">START <span className="float-right font-medium text-[#35593e]">{(trimStartMs / 1000).toFixed(1)}s</span><input aria-label="Clip trim start" type="range" min="0" max={Math.max(0, editableDurationMs - 500)} step="100" value={Math.min(trimStartMs, Math.max(0, editableDurationMs - 500))} onChange={event => setTrimStartMs(Number(event.target.value))} className="mt-2 w-full accent-[#7da840]" /></label><label className="block text-[10px] font-semibold text-[#61736a]">END <span className="float-right font-medium text-[#35593e]">{((trimEndMs || editableDurationMs) / 1000).toFixed(1)}s</span><input aria-label="Clip trim end" type="range" min={Math.min(trimStartMs + 500, editableDurationMs)} max={editableDurationMs} step="100" value={Math.max(Math.min(trimEndMs || editableDurationMs, editableDurationMs), Math.min(trimStartMs + 500, editableDurationMs))} onChange={event => setTrimEndMs(Number(event.target.value))} className="mt-2 w-full accent-[#7da840]" /></label></div><div className="mt-3 flex gap-2"><button onClick={() => void saveClipTrim()} disabled={setClipTrim.isPending} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#244337] px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-[#315849] disabled:opacity-50">{setClipTrim.isPending ? <Loader2 className="size-3 animate-spin" /> : <Save size={13} />} Save trim</button><button onClick={() => { setTrimStartMs(0); setTrimEndMs(editableDurationMs); }} className="rounded-lg border border-[#cbdac1] bg-white px-3 py-2 text-[10px] font-semibold text-[#5c7364] transition hover:bg-[#fbfcf9]">Reset</button></div></div>}
            {project && <div className="mt-4 flex items-center justify-between rounded-xl border border-[#e4e6e1] bg-white px-3 py-2"><span className="text-[10px] font-semibold text-[#728078]">File access</span><select value={retentionValue} disabled={setRetention.isPending} onChange={event => { const retention = event.target.value as "seven_days" | "thirty_days" | "keep"; void setRetention.mutateAsync({ projectId: project.id, retention }).then(async () => { await utils.video.listProjects.invalidate(); toast.success(retention === "keep" ? "เก็บไฟล์ไว้จนกว่าจะลบเอง" : "ตั้งอายุการเข้าถึงไฟล์แล้ว"); }).catch(error => toast.error(error instanceof Error ? error.message : "ตั้งอายุไฟล์ไม่สำเร็จ")); }} className="bg-transparent text-[10px] font-semibold text-[#557248] outline-none"><option value="seven_days">Expire in 7 days</option><option value="thirty_days">Expire in 30 days</option><option value="keep">Keep until I delete</option></select></div>}
          </section>
        </div>

        <section className="mt-5 rounded-[24px] border border-[#dfdfd9] bg-[#fbfaf8] p-5 shadow-[0_20px_60px_rgba(31,43,37,.05)] lg:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf5dc] text-[#719d40]"><WandSparkles size={17} /></div><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#779775]">02 / Creative direction</p><h2 className="font-display text-xl font-semibold tracking-[-.04em]">Tell Cineflow what to do</h2></div></div><div className="flex items-center gap-1.5 text-[11px] font-medium text-[#708078]"><Languages size={14} /> Thai & English supported</div></div>
          <div className="relative"><textarea value={command} onChange={event => setCommand(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submitCommand(); }} placeholder="เช่น “ตัดช่วงเงียบทั้งหมด แล้วสร้างซับภาษาไทย” หรือ “Remove silence and crop to 16:9”" className="min-h-[108px] w-full resize-none rounded-[18px] border border-[#d8ddd7] bg-[#f9faf8] px-4 pb-11 pt-4 text-sm leading-6 outline-none transition placeholder:text-[#9aa39f] focus:border-[#8cb65a] focus:ring-4 focus:ring-[#e6f2d0]" />
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] text-[#89938e]"><kbd className="rounded border border-[#dbe0d9] bg-white px-1.5 py-0.5 font-sans">⌘</kbd><kbd className="rounded border border-[#dbe0d9] bg-white px-1.5 py-0.5 font-sans">Enter</kbd> to run</div>
            <button disabled={createJob.isPending || !command.trim() || !project} onClick={() => void submitCommand()} className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-xl bg-[#172e29] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#274b40] disabled:cursor-not-allowed disabled:opacity-45 active:scale-[.97]">{createJob.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />} Create edit <ChevronRight size={14} /></button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{prompts.map(prompt => <button key={prompt} onClick={() => setCommand(prompt)} className="rounded-full border border-[#dfe4db] bg-white px-3 py-1.5 text-[11px] font-medium text-[#5f6e68] transition hover:border-[#a8c67a] hover:bg-[#f3f8e9]">{prompt}</button>)}</div>
            {requestsSubtitles && <div className="mt-5 rounded-2xl border border-[#dfe7d7] bg-[#f5f9ef] p-4"><div className="mb-3 flex items-center gap-2 text-[#537644]"><Captions size={15} /><p className="text-xs font-semibold">Subtitle style for this edit</p></div><div className="grid gap-2 sm:grid-cols-3">{(Object.entries(SUBTITLE_PRESETS) as [Exclude<SubtitlePresetId, "custom">, (typeof SUBTITLE_PRESETS)[Exclude<SubtitlePresetId, "custom">]][]).map(([id, preset]) => <button key={id} onClick={() => chooseSubtitlePreset(id)} className={`rounded-xl border p-3 text-left transition ${subtitlePreset === id ? "border-[#83ab55] bg-white shadow-sm" : "border-[#dce6d3] bg-white/55 hover:bg-white"}`}><p className="text-[11px] font-bold text-[#385139]">{preset.label}</p><p className="mt-1 text-[10px] leading-4 text-[#718078]">{preset.description}</p></button>)}</div><div className="mt-4 rounded-xl border border-[#dce6d3] bg-white/75 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#58774b]">Your saved presets</p><span className="text-[10px] text-[#7b887f]">{customPresets.length}/20</span></div>{customPresetsQuery.isLoading ? <div className="grid h-10 place-items-center"><Loader2 className="size-3.5 animate-spin text-[#779f45]" /></div> : customPresets.length ? <div className="flex flex-wrap gap-2">{customPresets.map(preset => <div key={preset.id} className={`flex items-center gap-1 rounded-lg border px-1 py-1 transition ${selectedCustomPresetId === preset.id && subtitlePreset === "custom" ? "border-[#81aa52] bg-[#eff7e6]" : "border-[#d9e2d2] bg-white"}`}><button onClick={() => chooseSavedSubtitlePreset(preset)} className="px-1.5 py-1 text-[10px] font-semibold text-[#405c43]">{preset.name}</button><button aria-label={`Delete preset ${preset.name}`} onClick={() => void removeCustomSubtitlePreset(preset)} disabled={deleteCustomSubtitlePreset.isPending} className="rounded p-1 text-[#9e625c] transition hover:bg-rose-50 disabled:opacity-40"><Trash2 size={12} /></button></div>)}</div> : <p className="text-[10px] leading-4 text-[#79877e]">บันทึกรูปแบบที่ใช้บ่อยไว้ใช้กับคลิปถัดไปในเบราว์เซอร์นี้</p>}</div><button onClick={() => chooseSubtitlePreset("custom")} className={`mt-3 text-[10px] font-semibold ${subtitlePreset === "custom" ? "text-[#456d36]" : "text-[#738179] hover:text-[#456d36]"}`}>Customize manually</button><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-[10px] font-semibold text-[#6c7971]">FONT<select value={subtitleStyle.font} onChange={event => updateCustomStyle({ font: event.target.value as "Noto Sans Thai" | "Arial" | "Inter" })} className="mt-1.5 block w-full rounded-lg border border-[#d7e0d1] bg-white px-2.5 py-2 text-xs font-medium text-[#26382f] outline-none"><option>Noto Sans Thai</option><option>Arial</option><option>Inter</option></select></label><label className="text-[10px] font-semibold text-[#6c7971]">SIZE<select value={subtitleStyle.size} onChange={event => updateCustomStyle({ size: event.target.value as "small" | "medium" | "large" })} className="mt-1.5 block w-full rounded-lg border border-[#d7e0d1] bg-white px-2.5 py-2 text-xs font-medium text-[#26382f] outline-none"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label><label className="text-[10px] font-semibold text-[#6c7971]">POSITION<select value={subtitleStyle.position} onChange={event => updateCustomStyle({ position: event.target.value as "bottom" | "middle" | "top" })} className="mt-1.5 block w-full rounded-lg border border-[#d7e0d1] bg-white px-2.5 py-2 text-xs font-medium text-[#26382f] outline-none"><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label></div><div className="mt-3 flex gap-2"><input aria-label="Custom subtitle preset name" value={newPresetName} maxLength={80} onChange={event => setNewPresetName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void saveCustomSubtitlePreset(); }} placeholder="Name this subtitle style" className="min-w-0 flex-1 rounded-lg border border-[#d7e0d1] bg-white px-2.5 py-2 text-xs font-medium text-[#26382f] outline-none placeholder:text-[#a0aaa4] focus:border-[#8eb961]" /><button onClick={() => void saveCustomSubtitlePreset()} disabled={createCustomSubtitlePreset.isPending || updateCustomSubtitlePreset.isPending || !newPresetName.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#244337] px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-[#315849] disabled:opacity-40">{createCustomSubtitlePreset.isPending || updateCustomSubtitlePreset.isPending ? <Loader2 className="size-3 animate-spin" /> : <Save size={12} />}{selectedCustomPresetId ? "Update preset" : "Save preset"}</button></div></div>}
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(290px,.8fr)]">
          <div className="rounded-[24px] border border-[#dfdfd9] bg-[#fbfaf8] p-5 shadow-[0_20px_60px_rgba(31,43,37,.05)]"><div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#779775]">03 / Processing queue</p><h2 className="mt-1 font-display text-xl font-semibold tracking-[-.04em]">Your edit history</h2></div><button onClick={() => void refreshVideoData()} className="rounded-full border border-[#dde4d8] px-3 py-1.5 text-[11px] font-semibold text-[#60736a] transition hover:bg-[#f3f8ea]">Refresh</button></div>
            {jobsQuery.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-[#799f4d]" /></div> : recentJobs.length ? <div className="space-y-3">{recentJobs.map(job => <article key={job.id} className="rounded-2xl border border-[#e4e5e1] bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{job.command}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{job.operationPlan.operations.map(operation => <span key={`${job.id}-${operation.type}`} className="rounded-md bg-[#f1f6e8] px-1.5 py-0.5 text-[10px] font-medium text-[#658342]">{planLabel(operation.type)}</span>)}</div></div><div className="flex items-center gap-2"><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${statusClass(job.status)}`}>{statusLabel(job.status)}</span><button aria-label="Delete edit" onClick={() => { if (window.confirm("ลบงานนี้และเพิกถอนสิทธิ์เข้าถึงผลลัพธ์หรือไม่?")) void deleteJob.mutateAsync({ jobId: job.id }).then(() => refreshVideoData()).catch(error => toast.error(error instanceof Error ? error.message : "ไม่สามารถลบงานได้")); }} className="rounded-md p-1 text-[#9f625d] hover:bg-rose-50"><Trash2 size={14} /></button></div></div>{job.status === "queued" || job.status === "processing" ? <div className="mt-4"><div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-[#7c8782]"><span>{job.status === "processing" ? "FFmpeg is working" : "Preparing your edit"}</span><span>{job.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#edf0eb]"><div className="h-full rounded-full bg-[#95c24f] transition-all duration-500" style={{ width: `${job.progress}%` }} /></div></div> : job.status === "complete" ? <div className="mt-4 flex flex-wrap gap-2"><a href={`/api/video-jobs/${job.id}/download?asset=video`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#17302a] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#294b40]"><Download size={13} /> Download video</a>{job.subtitleUrl && <a href={`/api/video-jobs/${job.id}/download?asset=subtitle`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9e2d3] px-3 py-1.5 text-[11px] font-semibold text-[#536a5e] transition hover:bg-[#f4f8ed]"><Download size={13} /> Download SRT</a>}</div> : <p className="mt-3 text-[11px] text-rose-700">{job.errorMessage || "This edit needs another try."}</p>}</article>)}</div> : <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-[#d9ded7] bg-[#f8f9f7] text-center"><div><Clock3 className="mx-auto mb-3 size-5 text-[#8a978f]" /><p className="text-sm font-semibold text-[#51615a]">No edits yet</p><p className="mt-1 text-[11px] text-[#87918c]">Your completed and in-progress jobs will live here.</p></div></div>}</div>
          <aside className="rounded-[24px] bg-[#e6f0df] p-5 text-[#20372f] shadow-[0_20px_60px_rgba(31,43,37,.05)]"><div className="mb-7 flex items-center justify-between"><span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.13em] text-[#577c52]">live status</span><span className="size-2 rounded-full bg-[#8abe36] shadow-[0_0_0_4px_rgba(138,190,54,.15)]" /></div>{activeJob ? <><p className="font-display text-2xl font-semibold tracking-[-.04em]">Editing in progress</p><p className="mt-2 text-xs leading-5 text-[#5a6f64]">We are applying your approved edit plan to the assembled timeline. You can stay here while the status updates.</p><div className="mt-7 rounded-2xl bg-white/65 p-4"><div className="mb-2 flex items-center justify-between text-[11px] font-semibold"><span>{activeJob.progress}% complete</span><span className="text-[#708679]">{statusLabel(activeJob.status)}</span></div><div className="h-2 overflow-hidden rounded-full bg-[#d5e2d0]"><div className="h-full rounded-full bg-[#79a83c]" style={{ width: `${activeJob.progress}%` }} /></div></div></> : <><CheckCircle2 className="mb-4 size-6 text-[#6d9c3d]" /><p className="font-display text-2xl font-semibold tracking-[-.04em]">Studio is ready</p><p className="mt-2 text-xs leading-5 text-[#5a6f64]">Arrange your clips, describe the edit, and choose subtitle styling whenever your command asks for captions.</p><div className="mt-7 space-y-3">{[["Clip join", "Assembles your chosen order"], ["Smart subtitles", "Whisper transcription with style"], ["Privacy", "Delete or set an access expiry"]].map(([title, copy], index) => <div className="flex items-start gap-3" key={title}><span className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold text-[#6b9940]">0{index + 1}</span><div><p className="text-[11px] font-bold">{title}</p><p className="mt-0.5 text-[10px] text-[#62776c]">{copy}</p></div></div>)}</div></>}</aside>
        </section>
        {isProjectLibraryOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#13231ed1] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Project library"><section className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[24px] bg-[#fbfaf8] shadow-2xl"><div className="flex items-start justify-between border-b border-[#e5e5df] p-5"><div><div className="flex items-center gap-2 text-[#5c8341]"><FolderOpen size={16} /><p className="text-[10px] font-bold uppercase tracking-[.14em]">Project library</p></div><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-.04em]">Open an earlier edit</h2><p className="mt-1 text-[11px] text-[#74817a]">โปรเจกต์อยู่ในเบราว์เซอร์นี้ และไม่แสดงงานที่ถูกลบหรือหมดอายุแล้ว</p></div><button aria-label="Close project library" onClick={() => setIsProjectLibraryOpen(false)} className="rounded-lg p-2 text-[#6e7d75] transition hover:bg-[#eef2eb]"><X size={17} /></button></div><div className="border-b border-[#e5e5df] p-4"><label className="flex items-center gap-2 rounded-xl border border-[#d9e0d6] bg-white px-3 py-2.5 text-[#7c8982]"><Search size={15} /><input aria-label="Search projects" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} placeholder="Search project names" className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[#273a31] outline-none placeholder:text-[#9aa49f]" /></label></div><div className="max-h-[53vh] space-y-2 overflow-y-auto p-4">{searchedProjectsQuery.isLoading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-[#6f9a4d]" /></div> : (searchedProjectsQuery.data ?? []).length ? (searchedProjectsQuery.data ?? []).map(item => <button key={item.id} onClick={() => { setSelectedProjectId(item.id); setSelectedClipId(null); setIsProjectLibraryOpen(false); }} className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${item.id === selectedProjectId ? "border-[#91ba5c] bg-[#f1f7e8]" : "border-[#e3e6e1] bg-white hover:border-[#b9d195]"}`}><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#2a4035]">{item.title}</p><p className="mt-1 text-[10px] text-[#78867e]">Project #{item.id} · {new Date(item.createdAt).toLocaleDateString()}</p></div><span className="shrink-0 rounded-lg bg-[#edf4e3] px-2.5 py-1.5 text-[10px] font-semibold text-[#587a3d]">Open</span></button>) : <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-[#d8ded6] text-center"><p className="text-xs text-[#7a8880]">ไม่พบโปรเจกต์ที่ตรงกับคำค้นหา</p></div>}</div></section></div>}
      </main>
    </div>
  );
}
