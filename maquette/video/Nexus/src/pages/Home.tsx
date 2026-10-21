import { AppWindow, Battery, CalendarPlus, Cpu, Globe, ListPlus, MemoryStick, MonitorPlay, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Dot, Empty, Input, Modal, StatusPill, cx, fmtBytes, fmtTime, statusMeta } from "../components/ui";
import { api, type ActivityRow, type AppRow, type SystemSnapshot, type TaskRow } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

function Meter({ label, value, sub, icon: Icon }: { label: string; value: number; sub: string; icon: typeof Cpu }) {
  const tone = value > 85 ? "from-bad to-bad/70" : value > 60 ? "from-warn to-warn/70" : "from-sky to-violet";
  return (
    <div className="rounded-xl border border-line bg-black/20 p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">{Math.round(value)}<span className="text-sm text-mute">%</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cx("h-full rounded-full bg-gradient-to-r transition-[width] duration-700", tone)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <div className="mt-1.5 truncate text-[11px] text-dim">{sub}</div>
    </div>
  );
}

export function AppPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run } = useNexus();
  const L = useL();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { if (open) api.listApps().then(setApps).catch(() => {}); }, [open]);
  const shown = apps.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 120);
  return (
    <Modal open={open} onClose={onClose} title={L("Ouvrir une application", "Open an application")}>
      <Input autoFocus placeholder={L("Rechercher parmi les applications installées…", "Search installed applications…")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-[50vh] space-y-0.5 overflow-y-auto">
        {shown.map((a) => (
          <button key={a.id} onClick={async () => { await run(api.launchApp(a.id), `${a.name} ${L("lancé", "launched")}`); onClose(); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.05]">
            <AppWindow className="h-4 w-4 text-dim" />
            <span className="flex-1 truncate text-[13px]">{a.name}</span>
            {a.running && <span className="text-[10px] font-semibold text-ok">{L("ouvert", "running")}</span>}
            <span className="text-[10px] text-dim">{a.source}</span>
          </button>
        ))}
        {shown.length === 0 && <Empty title={L("Aucune application", "No applications")} />}
      </div>
    </Modal>
  );
}

export default function HomePage() {
  const { state, go, run, lang } = useNexus();
  const L = useL();
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    const poll = () => api.systemSnapshot().then((s) => alive && setSnap(s)).catch(() => {});
    poll();
    const t = window.setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const loadLists = () => {
    api.listActivity(12).then(setActivity).catch(() => {});
    api.listTasks().then(setTasks).catch(() => {});
  };
  useEffect(loadLists, []);
  useEvent("nexus://activity", loadLists);

  const current = tasks.find((t) => ["RUNNING", "WAITING_PERMISSION", "WAITING_USER"].includes(t.status));
  const s = state ? statusMeta[state.status] : statusMeta.IDLE;
  const mem = snap ? (snap.system.memoryUsed / Math.max(1, snap.system.memoryTotal)) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] text-mute">{new Date().toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight">{L("Bonjour.", "Hello.")} <span className="accent-text">NEXUS</span> {L("est prêt.", "is ready.")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<AppWindow className="h-4 w-4" />} onClick={() => setPicker(true)}>{L("Ouvrir une app", "Open App")}</Button>
          <Button icon={<ListPlus className="h-4 w-4" />} onClick={() => go("chat")}>{L("Créer une tâche", "Create Task")}</Button>
          <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => go("calendar")}>{L("Événement", "Calendar Event")}</Button>
          <Button variant="primary" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => go("control")}>{L("Contrôler l'écran", "Control Screen")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-4" title={L("Statut NEXUS", "NEXUS status")}>
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-black/25"><Dot color={s.color} pulse={s.busy} /></div>
            <div>
              <div className="font-display text-lg font-semibold" style={{ color: s.color }}>{lang === "en" ? s.en : s.fr}</div>
              <div className="text-xs text-mute">{L("Mode", "Mode")} {state?.mode} · {state?.aiConfigured ? state.model : L("IA non configurée", "AI not configured")}</div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-line bg-black/20 p-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">{L("Tâche en cours", "Current task")}</div>
            {current ? (
              <button className="mt-1.5 flex w-full items-center gap-2 text-left" onClick={() => go("tasks", current.id)}>
                <span className="min-w-0 flex-1 truncate text-[13px]">{current.title}</span><StatusPill status={current.status} />
              </button>
            ) : <div className="mt-1.5 text-[13px] text-dim">{L("Aucune", "None")}</div>}
          </div>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (search.trim()) run(api.webSearch(search), L("Recherche ouverte", "Search opened")).then(() => setSearch("")); }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L("Rechercher sur le web…", "Search the web…")} />
            <Button type="submit" icon={<Search className="h-4 w-4" />} aria-label="Search" />
          </form>
        </Card>

        <div className="col-span-12 grid grid-cols-2 gap-4 lg:col-span-8 xl:grid-cols-4">
          <Meter label="CPU" icon={Cpu} value={snap?.system.cpuPercent ?? 0} sub={snap ? `${snap.system.cpuBrand} · ${snap.system.cpuCount} threads` : "…"} />
          <Meter label="RAM" icon={MemoryStick} value={mem} sub={snap ? `${fmtBytes(snap.system.memoryUsed)} / ${fmtBytes(snap.system.memoryTotal)}` : "…"} />
          <div className="rounded-xl border border-line bg-black/20 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute"><Battery className="h-3.5 w-3.5" />{L("Batterie", "Battery")}</div>
            <div className="mt-2 font-display text-2xl font-semibold">{snap?.battery.present ? `${snap.battery.percent ?? "?"}%` : "—"}</div>
            <div className="mt-1.5 text-[11px] text-dim">{snap?.battery.present ? (snap.battery.charging ? L("En charge", "Charging") : snap.battery.onAc ? L("Secteur", "On AC") : L("Sur batterie", "On battery")) : L("Aucune batterie (PC fixe)", "No battery (desktop)")}</div>
          </div>
          <div className="rounded-xl border border-line bg-black/20 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute"><AppWindow className="h-3.5 w-3.5" />{L("App active", "Active app")}</div>
            <div className="mt-2 truncate text-[14px] font-medium">{snap?.activeWindow?.process?.replace(/\.exe$/i, "") ?? "—"}</div>
            <div className="mt-1.5 truncate text-[11px] text-dim" title={snap?.activeWindow?.title}>{snap?.activeWindow?.title ?? ""}</div>
          </div>
          <div className="col-span-2 rounded-xl border border-line bg-black/20 p-3.5 xl:col-span-4">
            <div className="flex items-center justify-between text-[11px] text-mute">
              <span>{snap?.system.os} · {snap?.system.host}</span>
              <span>{L("Allumé depuis", "Uptime")} {snap ? `${Math.floor(snap.system.uptimeSecs / 3600)} h ${Math.floor((snap.system.uptimeSecs % 3600) / 60)} min` : "—"}</span>
            </div>
          </div>
        </div>

        <Card className="col-span-12 lg:col-span-5" title={L("Calendrier du jour", "Today's calendar")} action={<Button size="sm" variant="ghost" onClick={() => go("calendar")}>{L("Ouvrir", "Open")}</Button>}>
          <div className="flex items-start gap-3 rounded-xl border border-line bg-black/20 p-3 text-xs text-mute">
            <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
            {L("Microsoft Calendar n'est pas encore connecté (phase 8). Aucun événement n'est affiché plutôt que d'en inventer.",
               "Microsoft Calendar is not connected yet (phase 8). No events are shown rather than inventing any.")}
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-7" title={L("Activité récente", "Recent activity")} action={<Button size="sm" variant="ghost" onClick={() => go("activity")}>{L("Tout voir", "View all")}</Button>}>
          {activity.length === 0 ? <Empty icon={<Globe className="h-6 w-6" />} title={L("Aucune activité", "No activity yet")} /> : (
            <ul className="divide-y divide-line">
              {activity.map((a, i) => (
                <li key={a.id ?? i} className="flex items-center gap-3 py-2 text-[12.5px]">
                  <span className="w-16 shrink-0 font-mono text-[10.5px] text-dim">{fmtTime(a.ts)}</span>
                  <span className="min-w-0 flex-1 truncate text-fg/90">{a.action}</span>
                  <StatusPill status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <AppPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}
