import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, LayoutDashboard, Loader2, LockKeyhole, Settings2, ShieldCheck } from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";

export function SystemAdminShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const utils = trpc.useUtils();
  const access = trpc.system.access.useQuery();
  const unlock = trpc.system.unlock.useMutation({ onSuccess: () => void utils.system.access.invalidate() });
  const [token, setToken] = useState("");

  if (access.isLoading) return <div className="grid min-h-screen place-items-center bg-[#f6f5f2]"><Loader2 className="size-6 animate-spin text-[#5d8141]" /></div>;
  if (!access.data?.authorized) {
    const submit = async (event: FormEvent) => {
      event.preventDefault();
      try { await unlock.mutateAsync({ token }); setToken(""); } catch { /* surface the error below */ }
    };
    return <main className="grid min-h-screen place-items-center bg-[#f6f5f2] px-5 text-[#17201e]"><form onSubmit={submit} className="w-full max-w-md rounded-[28px] border border-[#dce5d5] bg-white p-7 shadow-[0_20px_70px_rgba(31,43,37,.1)]"><div className="mb-5 grid size-11 place-items-center rounded-2xl bg-[#1b2421] text-[#c5f165]"><LockKeyhole size={20} /></div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#74985d]">Cineflow system</p><h1 className="mt-1 font-display text-2xl font-semibold tracking-[-.045em]">Administrator access</h1><p className="mt-2 text-sm leading-6 text-[#68746e]">ป้อน administrator token ที่กำหนดไว้ตอนติดตั้ง เพื่อดูสถานะระบบหรือเปลี่ยน provider credentials ได้อย่างปลอดภัย</p><label className="mt-6 block text-xs font-semibold text-[#405046]">ADMINISTRATOR TOKEN<Input type="password" autoComplete="current-password" value={token} onChange={event => setToken(event.target.value)} className="mt-2 h-11 border-[#d6ded1] bg-[#fbfcfa]" placeholder="Paste deployment admin token" /></label>{unlock.isError && <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-700"><AlertTriangle size={14} /> {unlock.error.message}</p>}<Button type="submit" disabled={!token || unlock.isPending} className="mt-5 h-11 w-full bg-[#244337] text-white hover:bg-[#315849]">{unlock.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Unlock system console</Button><Link href="/" className="mt-4 block text-center text-xs font-medium text-[#668151] hover:underline">กลับไปที่ video editor</Link></form></main>;
  }

  return <div className="min-h-screen bg-[#f6f5f2] text-[#17201e]"><header className="border-b border-[#e7e4de] bg-[#fbfaf8]/90 backdrop-blur-xl"><div className="mx-auto flex min-h-[76px] max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-10"><Link href="/" className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#152b27] text-[#c5f165]"><ShieldCheck size={19} /></div><div><p className="font-display text-[17px] font-semibold tracking-[-.04em]">Cineflow</p><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#77827f]">SYSTEM CONSOLE</p></div></Link><nav className="flex items-center gap-1 rounded-xl border border-[#dce5d5] bg-white p-1 text-xs font-semibold"><Link href="/system" className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 transition ${location === "/system" ? "bg-[#edf5dd] text-[#45672f]" : "text-[#69766f] hover:bg-[#f4f6f0]"}`}><LayoutDashboard size={14} /> Dashboard</Link><Link href="/settings" className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 transition ${location === "/settings" ? "bg-[#edf5dd] text-[#45672f]" : "text-[#69766f] hover:bg-[#f4f6f0]"}`}><Settings2 size={14} /> Settings</Link></nav></div></header><main className="mx-auto max-w-[1280px] px-5 py-7 lg:px-10 lg:py-9">{children}</main></div>;
}
