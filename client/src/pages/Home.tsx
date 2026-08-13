import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FileVideo2,
  Film,
  Languages,
  Loader2,
  Play,
  Plus,
  Scissors,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Project = {
  id: number;
  title: string;
  sourceFileName: string;
  sourceUrl: string;
  sourceBytes: number;
};

const prompts = [
  "ตัดช่วงเงียบทั้งหมด",
  "สร้างซับไตเติลอัตโนมัติ",
  "Crop video to 16:9",
  "Keep the first 30 seconds",
];

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
  const [project, setProject] = useState<Project | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [command, setCommand] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const jobsQuery = trpc.video.listJobs.useQuery(undefined, {
    refetchInterval: query => query.state.data?.some(job => job.status === "queued" || job.status === "processing") ? 2000 : false,
  });
  const createJob = trpc.video.createJob.useMutation();

  const recentJobs = useMemo(() => jobsQuery.data?.slice(0, 4) ?? [], [jobsQuery.data]);
  const activeJob = useMemo(() => recentJobs.find(job => job.status === "queued" || job.status === "processing"), [recentJobs]);

  useEffect(() => () => {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

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
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    try {
      const response = await fetch("/api/video-upload", {
        method: "POST",
        headers: videoApiHeaders({ "content-type": file.type || "video/mp4", "x-file-name": file.name, "x-file-type": file.type || "video/mp4" }),
        body: file,
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error ?? "Unable to upload video");
      setProject(data.project);
      setPreviewUrl(data.project.sourceUrl);
      toast.success("อัปโหลดวิดีโอแล้ว พร้อมสั่งงานได้เลย");
    } catch (error) {
      setProject(null);
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
      const job = await createJob.mutateAsync({ projectId: project.id, command });
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

  return (
    <div className="min-h-screen bg-[#f6f5f2] text-[#17201e]">
      <header className="border-b border-[#e7e4de] bg-[#fbfaf8]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#152b27] text-[#c5f165] shadow-[0_8px_22px_rgba(21,43,39,.18)]"><Film size={19} strokeWidth={1.8} /></div>
            <div>
              <p className="font-display text-[17px] font-semibold tracking-[-0.04em]">Cineflow</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77827f]">AI VIDEO STUDIO</p>
            </div>
          </div>
          <div className="hidden items-center gap-8 text-[13px] font-medium text-[#66716d] md:flex">
            <span className="text-[#18211f]">Editor</span><span>Library</span><span>Help</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#dfe5d9] bg-[#f3f8e8] px-3 py-2 text-[11px] font-semibold text-[#496935]"><span className="size-1.5 rounded-full bg-[#91bf3b]" /> Ready to edit</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-7 lg:px-10 lg:py-9">
        <section className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#53766a]"><span className="size-1.5 rounded-full bg-[#a5d83d]" /> AI-powered editing</p><h1 className="font-display text-3xl font-semibold tracking-[-0.055em] sm:text-[40px]">Make the cut. <span className="text-[#789c55]">Say the word.</span></h1><p className="mt-2 max-w-xl text-sm leading-6 text-[#67726e]">อัปโหลดวิดีโอ แล้วบอกสิ่งที่ต้องการด้วยภาษาไทยหรือ English. เราจะแปลงคำสั่งของคุณเป็นงานตัดต่อที่ตรวจสอบได้</p><p className="mt-2 text-[11px] font-medium text-[#78827c]">เริ่มได้ทันที ไม่ต้อง Sign in — งานของคุณผูกกับเบราว์เซอร์นี้</p></div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e3e4df] bg-[#fbfaf8] px-4 py-3"><div className="grid size-8 place-items-center rounded-lg bg-[#eef6d9] text-[#6c9131]"><Sparkles size={15} /></div><div><p className="text-xs font-semibold">Thai + English commands</p><p className="text-[11px] text-[#7a8580]">understood naturally</p></div></div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_390px]">
          <section className="overflow-hidden rounded-[24px] border border-[#dfdfd9] bg-[#1b2421] shadow-[0_20px_60px_rgba(31,43,37,.08)]">
            <div className="flex h-14 items-center justify-between border-b border-white/10 px-5 text-white"><div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#c4ef55]" /><span className="text-xs font-semibold">Source preview</span></div>{project ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white/70">{formatBytes(project.sourceBytes)}</span> : <span className="text-[11px] text-white/45">Ready when you are</span>}</div>
            <div className="relative aspect-video bg-[radial-gradient(circle_at_42%_30%,#405e50_0%,#25372f_35%,#141c19_78%)]">
              {previewUrl ? <video controls className="size-full object-contain" src={previewUrl} /> : <div className="absolute inset-0 grid place-items-center"><div className="text-center text-white"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-white/10 text-[#d0ef91]"><Play size={22} fill="currentColor" /></div><p className="text-sm font-medium">Your preview will appear here</p><p className="mt-1 text-xs text-white/55">MP4, MOV, WebM and more</p></div></div>}
              {isUploading && <div className="absolute inset-0 grid place-items-center bg-[#14211dcc] backdrop-blur-sm"><div className="rounded-2xl bg-white px-5 py-4 text-center shadow-xl"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-[#5d8337]" /><p className="text-xs font-semibold text-[#17201e]">Uploading securely</p><p className="mt-1 text-[11px] text-[#68736f]">Saving your source to this browser session</p></div></div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1b2421] px-5 py-4"><div className="flex items-center gap-3 text-xs text-white/65"><FileVideo2 size={15} className="text-[#b9e65c]" /><span className="max-w-[260px] truncate">{project?.sourceFileName || "No source selected"}</span></div>{project && <button onClick={() => { setProject(null); setPreviewUrl(""); }} className="flex items-center gap-1.5 text-[11px] font-medium text-white/55 transition hover:text-white"><X size={14} /> Replace</button>}</div>
          </section>

          <section className="rounded-[24px] border border-[#dfdfd9] bg-[#fbfaf8] p-5 shadow-[0_20px_60px_rgba(31,43,37,.05)]">
            <div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#779775]">01 / Source</p><h2 className="mt-1 font-display text-xl font-semibold tracking-[-.04em]">Drop your footage</h2></div><UploadCloud className="size-5 text-[#6f9a4d]" /></div>
            <button onClick={() => inputRef.current?.click()} onDragOver={event => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={onDrop} className={`group grid min-h-[182px] w-full place-items-center rounded-[18px] border border-dashed px-6 text-center transition ${isDragging ? "border-[#87b84b] bg-[#f2f9df]" : "border-[#cdd8cc] bg-[#f7f8f5] hover:border-[#8ab05d] hover:bg-[#f4f8ea]"}`}>
              <div><div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-white text-[#6d9846] shadow-sm transition group-hover:-translate-y-0.5"><Plus size={19} /></div><p className="text-sm font-semibold">Drop video here</p><p className="mt-1 text-[11px] leading-5 text-[#74807b]">or browse from your computer<br />Maximum file size: 180 MB</p></div>
            </button>
            <input ref={inputRef} className="hidden" type="file" accept="video/*" onChange={onFileChange} />
            <div className="mt-4 grid grid-cols-3 divide-x divide-[#e4e6e1] rounded-xl border border-[#e4e6e1] bg-white px-1 py-2 text-center"><div><p className="text-[10px] font-semibold text-[#7d8883]">SESSION</p><p className="mt-1 text-[11px] font-bold">No sign in</p></div><div><p className="text-[10px] font-semibold text-[#7d8883]">COMMANDS</p><p className="mt-1 text-[11px] font-bold">TH / EN</p></div><div><p className="text-[10px] font-semibold text-[#7d8883]">PROCESSING</p><p className="mt-1 text-[11px] font-bold">FFmpeg</p></div></div>
          </section>
        </div>

        <section className="mt-5 rounded-[24px] border border-[#dfdfd9] bg-[#fbfaf8] p-5 shadow-[0_20px_60px_rgba(31,43,37,.05)] lg:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#edf5dc] text-[#719d40]"><WandSparkles size={17} /></div><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#779775]">02 / Creative direction</p><h2 className="font-display text-xl font-semibold tracking-[-.04em]">Tell Cineflow what to do</h2></div></div><div className="flex items-center gap-1.5 text-[11px] font-medium text-[#708078]"><Languages size={14} /> Thai & English supported</div></div>
          <div className="relative"><textarea value={command} onChange={event => setCommand(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submitCommand(); }} placeholder="เช่น “ตัดช่วงเงียบทั้งหมด แล้วสร้างซับภาษาไทย” หรือ “Remove silence and crop to 16:9”" className="min-h-[108px] w-full resize-none rounded-[18px] border border-[#d8ddd7] bg-[#f9faf8] px-4 pb-11 pt-4 text-sm leading-6 outline-none transition placeholder:text-[#9aa39f] focus:border-[#8cb65a] focus:ring-4 focus:ring-[#e6f2d0]" />
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] text-[#89938e]"><kbd className="rounded border border-[#dbe0d9] bg-white px-1.5 py-0.5 font-sans">⌘</kbd><kbd className="rounded border border-[#dbe0d9] bg-white px-1.5 py-0.5 font-sans">Enter</kbd> to run</div>
            <button disabled={createJob.isPending || !command.trim()} onClick={() => void submitCommand()} className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-xl bg-[#172e29] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#274b40] disabled:cursor-not-allowed disabled:opacity-45 active:scale-[.97]">{createJob.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />} Create edit <ChevronRight size={14} /></button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{prompts.map(prompt => <button key={prompt} onClick={() => setCommand(prompt)} className="rounded-full border border-[#dfe4db] bg-white px-3 py-1.5 text-[11px] font-medium text-[#5f6e68] transition hover:border-[#a8c67a] hover:bg-[#f3f8e9]">{prompt}</button>)}</div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(290px,.8fr)]">
          <div className="rounded-[24px] border border-[#dfdfd9] bg-[#fbfaf8] p-5 shadow-[0_20px_60px_rgba(31,43,37,.05)]"><div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#779775]">03 / Processing queue</p><h2 className="mt-1 font-display text-xl font-semibold tracking-[-.04em]">Your edit history</h2></div><button onClick={() => void jobsQuery.refetch()} className="rounded-full border border-[#dde4d8] px-3 py-1.5 text-[11px] font-semibold text-[#60736a] transition hover:bg-[#f3f8ea]">Refresh</button></div>
            {jobsQuery.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-[#799f4d]" /></div> : recentJobs.length ? <div className="space-y-3">{recentJobs.map(job => <article key={job.id} className="rounded-2xl border border-[#e4e5e1] bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{job.command}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{job.operationPlan.operations.map(operation => <span key={`${job.id}-${operation.type}`} className="rounded-md bg-[#f1f6e8] px-1.5 py-0.5 text-[10px] font-medium text-[#658342]">{planLabel(operation.type)}</span>)}</div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${statusClass(job.status)}`}>{statusLabel(job.status)}</span></div>{job.status === "queued" || job.status === "processing" ? <div className="mt-4"><div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-[#7c8782]"><span>{job.status === "processing" ? "FFmpeg is working" : "Preparing your edit"}</span><span>{job.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#edf0eb]"><div className="h-full rounded-full bg-[#95c24f] transition-all duration-500" style={{ width: `${job.progress}%` }} /></div></div> : job.status === "complete" ? <div className="mt-4 flex flex-wrap gap-2"><a href={`/api/video-jobs/${job.id}/download?asset=video`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#17302a] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#294b40]"><Download size={13} /> Download video</a>{job.subtitleUrl && <a href={`/api/video-jobs/${job.id}/download?asset=subtitle`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9e2d3] px-3 py-1.5 text-[11px] font-semibold text-[#536a5e] transition hover:bg-[#f4f8ed]"><Download size={13} /> Download SRT</a>}</div> : <p className="mt-3 text-[11px] text-rose-700">{job.errorMessage || "This edit needs another try."}</p>}</article>)}</div> : <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-[#d9ded7] bg-[#f8f9f7] text-center"><div><Clock3 className="mx-auto mb-3 size-5 text-[#8a978f]" /><p className="text-sm font-semibold text-[#51615a]">No edits yet</p><p className="mt-1 text-[11px] text-[#87918c]">Your completed and in-progress jobs will live here.</p></div></div>}</div>
          <aside className="rounded-[24px] bg-[#e6f0df] p-5 text-[#20372f] shadow-[0_20px_60px_rgba(31,43,37,.05)]"><div className="mb-7 flex items-center justify-between"><span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.13em] text-[#577c52]">live status</span><span className="size-2 rounded-full bg-[#8abe36] shadow-[0_0_0_4px_rgba(138,190,54,.15)]" /></div>{activeJob ? <><p className="font-display text-2xl font-semibold tracking-[-.04em]">Editing in progress</p><p className="mt-2 text-xs leading-5 text-[#5a6f64]">We are applying your approved edit plan. You can stay here or continue working while the status updates.</p><div className="mt-7 rounded-2xl bg-white/65 p-4"><div className="mb-2 flex items-center justify-between text-[11px] font-semibold"><span>{activeJob.progress}% complete</span><span className="text-[#708679]">{statusLabel(activeJob.status)}</span></div><div className="h-2 overflow-hidden rounded-full bg-[#d5e2d0]"><div className="h-full rounded-full bg-[#79a83c]" style={{ width: `${activeJob.progress}%` }} /></div></div></> : <><CheckCircle2 className="mb-4 size-6 text-[#6d9c3d]" /><p className="font-display text-2xl font-semibold tracking-[-.04em]">Studio is ready</p><p className="mt-2 text-xs leading-5 text-[#5a6f64]">Upload a source, describe the edit, and we will show every operation before producing your deliverables.</p><div className="mt-7 space-y-3">{[["Silence removal", "Detects and joins speech segments"], ["Smart subtitles", "Whisper transcription to SRT"], ["Export", "Download your video or captions"]].map(([title, copy], index) => <div className="flex items-start gap-3" key={title}><span className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold text-[#6b9940]">0{index + 1}</span><div><p className="text-[11px] font-bold">{title}</p><p className="mt-0.5 text-[10px] text-[#62776c]">{copy}</p></div></div>)}</div></>}</aside>
        </section>
      </main>
    </div>
  );
}
