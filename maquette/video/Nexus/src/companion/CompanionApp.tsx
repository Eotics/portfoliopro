import {
  AppWindow, CalendarDays, ChevronsDownUp, Code2, FileUp, House, ListChecks, Maximize2, MessageSquare, MessageSquarePlus,
  Headphones, Mic, MicOff, Minimize2, Minus, MonitorPlay, OctagonX, PawPrint, PenLine, Play, Plug, Search, Settings as SettingsIcon, X,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "../components/Approval";
import { Button, Input, cx } from "../components/ui";
import { api, errMsg, type AppRow } from "../lib/api";
import { charLabel, characterState, type Outcome } from "../lib/companionState";
import { cues } from "../lib/sound";
import { useEvent, useL, useNexus } from "../lib/store";
import { useConversation } from "./useConversation";
import { useVoice } from "./useVoice";
import { CompanionFigure, useCompanionState, useLook } from "./Figure";
import { PetView } from "./Pet";
import { SIZE_PX } from "../lib/look";
import { AssistantView, CodeView, Composer, ComposerView, FilesView, IntegrationsView, MiniThread, TasksView } from "./views";

type WinMode = "pet" | "bar" | "compact" | "expanded";
type Tab = "assistant" | "files" | "tasks" | "code" | "composer" | "integrations";
// v2: the pet mode became the default; older saved modes are not reused once.
const MODE_KEY = "nexus.companion.mode.v2";

const ACTIONS: Record<string, { icon: typeof House; fr: string; en: string }> = {
  home: { icon: House, fr: "Accueil", en: "Home" },
  chat: { icon: MessageSquare, fr: "Chat", en: "Chat" },
  task: { icon: MessageSquarePlus, fr: "Nouvelle tâche", en: "New task" },
  files: { icon: FileUp, fr: "Ajouter des fichiers", en: "Add files" },
  control: { icon: MonitorPlay, fr: "Panneau de contrôle", en: "Control Panel" },
  settings: { icon: SettingsIcon, fr: "Paramètres", en: "Settings" },
  search: { icon: Search, fr: "Rechercher sur le web", en: "Search the web" },
  app: { icon: AppWindow, fr: "Ouvrir une application", en: "Open an application" },
  calendar: { icon: CalendarDays, fr: "Calendrier", en: "Calendar" },
  composer: { icon: PenLine, fr: "Rédiger", en: "Compose" },
  stop: { icon: OctagonX, fr: "STOP NEXUS", en: "STOP NEXUS" },
};

const TABS: { id: Tab; icon: typeof House; fr: string; en: string }[] = [
  { id: "assistant", icon: MessageSquare, fr: "Assistant", en: "Assistant" },
  { id: "files", icon: FileUp, fr: "Fichiers", en: "Files" },
  { id: "tasks", icon: ListChecks, fr: "Résultats", en: "Results" },
  { id: "code", icon: Code2, fr: "Code", en: "Code" },
  { id: "composer", icon: PenLine, fr: "Rédiger", en: "Compose" },
  { id: "integrations", icon: Plug, fr: "Intégrations", en: "Integrations" },
];

function VoiceButtons({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const L = useL();
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => void voice.toggleMic()} disabled={voice.transcribing}
        title={voice.recording ? L("Arrêter et envoyer", "Stop and send") : L("Parler (micro)", "Speak (microphone)")}
        aria-label={voice.recording ? L("Arrêter et envoyer", "Stop and send") : L("Parler", "Speak")}
        className={cx("relative grid h-9 w-9 place-items-center rounded-xl border transition-colors disabled:opacity-50",
          voice.recording ? "border-[#5eead4]/60 bg-[#5eead4]/15 text-[#5eead4]" : "border-line text-mute hover:text-fg")}>
        {voice.transcribing ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky border-t-transparent" /> : voice.recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {voice.recording && <span className="absolute inset-0 rounded-xl ring-2 ring-[#5eead4]/50" style={{ transform: `scale(${1 + Math.min(0.35, voice.level * 4)})`, transition: "transform 90ms" }} />}
      </button>
      <button onClick={voice.toggleConversation}
        title={voice.conversation ? L("Terminer la conversation vocale", "End voice conversation") : L("Conversation vocale (dites « stop » pour finir)", "Voice conversation (say \"stop\" to end)")}
        className={cx("grid h-9 w-9 place-items-center rounded-xl border transition-colors", voice.conversation ? "border-violet/60 bg-violet/15 text-violet" : "border-line text-mute hover:text-fg")}>
        <Headphones className="h-4 w-4" />
      </button>
    </div>
  );
}

function AppLauncher({ onDone }: { onDone: () => void }) {
  const { run, toast } = useNexus();
  const L = useL();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.listApps().then(setApps).catch(() => {}); }, []);
  const shown = apps.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input autoFocus placeholder={L("Quelle application ?", "Which application?")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((a) => (
          <button key={a.id} disabled={!!busy} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.05] disabled:opacity-50"
            onClick={async () => {
              setBusy(a.id);
              // Same pipeline as the AI: permission check, launch, verification, audit log.
              const r = await run(api.invokeTool("desktop.open_application", { name: a.name }));
              setBusy(null);
              if (r) toast(r.isError ? r.text : `${a.name}: ${r.outcome === "success" ? L("lancé et vérifié", "launched and verified") : L("lancé, non vérifié", "launched, not verified")}`, r.isError ? "error" : r.outcome === "success" ? "ok" : "info");
              if (r && !r.isError) onDone();
            }}>
            <AppWindow className="h-3.5 w-3.5 text-dim" /><span className="flex-1 truncate">{a.name}</span>
            {a.running && <span className="text-[10px] text-ok">{L("ouvert", "running")}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CompanionApp() {
  const { state, approvals, settings, outcome, run, toast, lang } = useNexus();
  const L = useL();
  const conv = useConversation();
  const voice = useVoice(conv);
  const look = useLook();
  const [mode, setModeState] = useState<WinMode>(() => { try { return (localStorage.getItem(MODE_KEY) as WinMode) || "pet"; } catch { return "pet"; } });
  const [tab, setTab] = useState<Tab>("assistant");
  const [listening, setListening] = useState(false);
  const [panel, setPanel] = useState<null | "search" | "app">(null);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const setMode = (m: WinMode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* optional */ }
    api.companionResize(m, petScale).catch((e) => toast(errMsg(e), "error"));
  };
  // The pet window follows the creature's size (Studio / right-click menu).
  const petScale = SIZE_PX[look?.size ?? "m"];
  useEffect(() => { api.companionResize(mode, petScale).catch(() => {}); }, [petScale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outcome "freshness" window for the success/concerned expression.
  useEffect(() => {
    if (!outcome) return;
    setNow(Date.now());
    const t = window.setTimeout(() => setNow(Date.now()), 8000);
    return () => clearTimeout(t);
  }, [outcome]);
  const fresh = outcome && now - outcome.at < 8000 && !state?.agentRunning ? (outcome.value as Outcome) : null;

  const csBase = characterState({
    status: state?.status, stopped: !!state?.stopped, pendingApprovals: approvals.length, freshOutcome: fresh, listening: listening || voice.recording,
  });
  // The microphone being open is shown as LISTENING; local transcription as THINKING.
  const cs = voice.recording && csBase !== "STOPPED" ? "LISTENING" : voice.transcribing && csBase === "IDLE" ? "THINKING" : csBase;
  const figState = useCompanionState(cs);

  // Optional sound cues, driven by real events only.
  useEvent<{ outcome: string }>("nexus://outcome", (o) => {
    if (!settings?.companionSounds) return;
    if (o.outcome === "success") cues.success();
    else if (o.outcome === "warnings" || o.outcome === "error") cues.error();
  });
  useEvent("nexus://approval", () => { if (settings?.companionSounds) cues.attention(); });

  // Files dropped while the Files view is not open: import them, then show the Files view.
  const filesOpen = mode === "expanded" && tab === "files";
  useEffect(() => {
    if (filesOpen) return;
    let un: (() => void) | undefined;
    let dead = false;
    getCurrentWebview().onDragDropEvent(async (ev) => {
      if (ev.payload.type !== "drop" || ev.payload.paths.length === 0) return;
      const r = await run(api.importFiles(ev.payload.paths));
      if (!r) return;
      const bad = r.filter((x) => !x.ok);
      if (bad.length) toast(bad.map((b) => ("name" in b ? `${b.name}: ${b.error}` : "")).join(" · "), "error");
      setTab("files");
      setMode("expanded");
    }).then((u) => { if (dead) u(); else un = u; });
    return () => { dead = true; un?.(); };
  }, [filesOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const motion = settings?.companionAnimation ?? "full";
  const accent = settings?.companionAccent ?? "sky";
  const actions = (settings?.companionActions ?? ["home", "chat", "task", "files", "control", "settings"]).filter((a) => ACTIONS[a]);

  const doAction = async (a: string) => {
    switch (a) {
      case "home": case "chat": case "control": case "settings": case "calendar":
        return run(api.showMain(a));
      case "task":
        conv.reset();
        if (mode === "bar") setMode("compact");
        setTimeout(() => inputRef.current?.focus(), 60);
        return;
      case "files": setTab("files"); return setMode("expanded");
      case "composer": setTab("composer"); return setMode("expanded");
      case "search": case "app":
        if (mode === "bar") setMode("compact");
        setPanel(panel === a ? null : a);
        return;
      case "stop": return run(api.stop());
    }
  };

  const bubble = useMemo(() => {
    if (state?.stopped) return L("Je suis arrêté. Réarmez-moi pour continuer.", "I'm stopped. Re-arm me to continue.");
    if (approvals[0]) return `${L("Autorisation requise", "Approval needed")} : ${approvals[0].summary}`;
    const lastRun = Object.values(conv.tools).find((t) => ["RUNNING", "VALIDATING", "CHECKING"].includes(t.status));
    if (state?.agentRunning && lastRun) return lastRun.summary ?? lastRun.tool;
    if (conv.error) return conv.error;
    return lang === "en" ? charLabel[cs].en : charLabel[cs].fr;
  }, [state, approvals, conv.tools, conv.error, cs, lang, L]);

  const toolbar = (
    <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line px-2.5">
      <button onClick={() => setMode(mode === "bar" ? "compact" : "bar")} title={L("Réduire / agrandir le panneau", "Collapse / expand panel")} className="rounded-lg p-0.5 hover:bg-white/5">
        <CompanionFigure state={figState} size={34} fixedSize look={look} accent={accent} motion={motion} title={charLabel[cs][lang]} />
      </button>
      <div data-tauri-drag-region className="mr-1 min-w-0 select-none">
        <div data-tauri-drag-region className="font-display text-[12px] font-bold tracking-[0.18em]">NEXUS</div>
        <div data-tauri-drag-region className="max-w-[90px] truncate text-[10px] text-mute">{charLabel[cs][lang]}</div>
      </div>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {actions.filter((a) => a !== "stop").map((a) => {
          const A = ACTIONS[a]!;
          return (
            <button key={a} onClick={() => void doAction(a)} title={lang === "en" ? A.en : A.fr} aria-label={lang === "en" ? A.en : A.fr}
              className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mute transition-colors hover:bg-white/[0.07] hover:text-fg", panel === a && "bg-white/[0.07] text-fg")}>
              <A.icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      {state?.stopped ? (
        <button onClick={() => run(api.rearm())} title={L("Réarmer NEXUS", "Re-arm NEXUS")} className="grid h-8 w-8 place-items-center rounded-lg border border-ok/40 bg-ok/10 text-ok"><Play className="h-4 w-4" /></button>
      ) : (
        <button onClick={() => run(api.stop())} title="STOP NEXUS (Ctrl+Alt+Backspace)" aria-label="STOP NEXUS"
          className="grid h-8 shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[#ff5d6e] to-[#d63447] px-2 text-[10px] font-bold tracking-wider text-white ring-1 ring-white/15 hover:brightness-110">
          <span className="flex items-center gap-1"><OctagonX className="h-3.5 w-3.5" />STOP</span>
        </button>
      )}
      <button onClick={() => setMode(mode === "expanded" ? "compact" : "expanded")} title={mode === "expanded" ? L("Vue compacte", "Compact view") : L("Espace de travail", "Workspace")}
        className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-white/[0.07] hover:text-fg">
        {mode === "expanded" ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      <button onClick={() => { setPanel(null); setMode("pet"); }} title={L("Mode compagnon (seulement la créature)", "Pet mode (just the creature)")} className="grid h-8 w-7 place-items-center rounded-lg text-mute hover:bg-white/[0.07] hover:text-fg"><PawPrint className="h-4 w-4" /></button>
      <button onClick={() => setMode("bar")} title={L("Réduire en barre", "Collapse to bar")} className="grid h-8 w-7 place-items-center rounded-lg text-mute hover:bg-white/[0.07] hover:text-fg"><Minus className="h-4 w-4" /></button>
      <button onClick={() => run(api.companionHide())} title={L("Masquer (rouvrir depuis NEXUS ou le raccourci)", "Hide (reopen from NEXUS or the shortcut)")} className="grid h-8 w-7 place-items-center rounded-lg text-mute hover:bg-bad/15 hover:text-bad"><X className="h-4 w-4" /></button>
    </div>
  );

  const quickPanel = panel && (
    <div className="border-b border-line p-3">
      {panel === "search" ? (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!query.trim()) return;
          const r = await run(api.invokeTool("browser.search", { query }));
          if (r) { toast(r.isError ? r.text : L("Recherche ouverte dans le navigateur", "Search opened in the browser"), r.isError ? "error" : "ok"); if (!r.isError) { setQuery(""); setPanel(null); } }
        }}>
          <Input autoFocus placeholder={L("Rechercher sur le web…", "Search the web…")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" icon={<Search className="h-4 w-4" />} disabled={!query.trim()} aria-label="Search" />
        </form>
      ) : (
        <div className="flex h-56 flex-col"><AppLauncher onDone={() => setPanel(null)} /></div>
      )}
    </div>
  );

  if (mode === "pet") {
    return (
      <PetView state={figState} look={look} motion={motion} accent={accent} title={charLabel[cs][lang]} bubble={bubble}
        alert={approvals.length > 0 || !!state?.stopped || cs === "ERROR"} voice={voice} scale={petScale}
        onOpen={(m) => { setMode(m); if (m === "compact") setTimeout(() => inputRef.current?.focus(), 120); }} />
    );
  }

  return (
    <div className={cx("flex h-full flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#0a0d12] text-fg shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]", settings && !settings.animations && "no-anim")}
      onKeyDown={(e) => { if (e.key === "Escape") { if (panel) setPanel(null); else if (mode === "expanded") setMode("compact"); else setMode("pet"); } }}>
      {toolbar}
      {mode !== "bar" && quickPanel}

      {mode === "compact" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            <CompanionFigure state={figState} size={76} look={look} accent={accent} motion={motion} title={charLabel[cs][lang]} />
            <div className={cx("relative min-w-0 flex-1 rounded-2xl rounded-bl-md border px-3 py-2 text-[12.5px] leading-snug",
              cs === "WAITING_PERMISSION" ? "border-warn/35 bg-warn/[0.07]" : cs === "ERROR" ? "border-bad/30 bg-bad/[0.06]" : cs === "SUCCESS" ? "border-ok/30 bg-ok/[0.06]" : "border-line bg-white/[0.04]")}>
              <div className="line-clamp-3">{bubble}</div>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
            {approvals.map((a) => <ApprovalCard key={a.id} req={a} compact />)}
            {conv.messages.length === 0 && !conv.pending && approvals.length === 0 && (
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {(lang === "en"
                  ? ["Open Opera GX", "What's using my RAM?", "Summarize my latest Inbox file", "Run my project's tests"]
                  : ["Ouvre Opera GX", "Qu'est-ce qui utilise ma RAM ?", "Résume le dernier fichier de mon Inbox", "Lance les tests de mon projet"]
                ).map((s) => (
                  <button key={s} onClick={() => void conv.send(s)} className="rounded-xl border border-line bg-white/[0.03] px-2.5 py-2 text-left text-[11.5px] text-mute hover:border-line-2 hover:text-fg">{s}</button>
                ))}
                <button onClick={() => { setTab("files"); setMode("expanded"); }} className="col-span-2 rounded-xl border border-dashed border-white/15 px-2.5 py-2 text-[11.5px] text-dim hover:border-[#5eead4]/60 hover:text-fg">
                  {L("Déposez des fichiers ici → espace de travail", "Drop files here → workspace")}
                </button>
              </div>
            )}
            <MiniThread conv={conv} limit={4} />
          </div>
          <div className="flex items-center gap-1.5 border-t border-line p-2.5">
            {voice.enabled && <VoiceButtons voice={voice} />}
            <div className="min-w-0 flex-1"><Composer conv={conv} onFocusChange={setListening} inputRef={inputRef} /></div>
            <button onClick={() => setMode("bar")} title={L("Replier en barre", "Collapse to bar")} className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-white/[0.06] hover:text-fg"><ChevronsDownUp className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {mode === "expanded" && (
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line p-2.5">
            <div className="mb-2 flex flex-col items-center gap-1.5 rounded-xl border border-line bg-white/[0.02] py-3">
              <CompanionFigure state={figState} size={64} look={look} accent={accent} motion={motion} title={charLabel[cs][lang]} />
              <div className="px-2 text-center text-[11px] text-mute">{charLabel[cs][lang]}</div>
            </div>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px]", tab === t.id ? "bg-white/[0.07] text-fg" : "text-mute hover:bg-white/[0.035] hover:text-fg")}>
                <t.icon className={cx("h-4 w-4", tab === t.id ? "text-sky" : "text-dim")} />{lang === "en" ? t.en : t.fr}
              </button>
            ))}
            <div className="mt-auto px-1 text-[10px] leading-relaxed text-dim">{L("Même agent, mêmes permissions et même journal que NEXUS.", "Same agent, permissions and log as NEXUS.")}</div>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            {approvals.length > 0 && tab !== "assistant" && tab !== "code" && (
              <div className="max-h-56 space-y-2 overflow-y-auto border-b border-line p-3">{approvals.map((a) => <ApprovalCard key={a.id} req={a} compact />)}</div>
            )}
            <div className="min-h-0 flex-1">
              {tab === "assistant" && (
                <div className="flex h-full flex-col">
                  {approvals.length > 0 && <div className="max-h-64 space-y-2 overflow-y-auto border-b border-line p-3">{approvals.map((a) => <ApprovalCard key={a.id} req={a} compact />)}</div>}
                  <div className="min-h-0 flex-1"><AssistantView conv={conv} voiceSlot={voice.enabled ? <VoiceButtons voice={voice} /> : null} /></div>
                </div>
              )}
              {tab === "files" && <FilesView conv={conv} onAsk={() => setTab("assistant")} />}
              {tab === "tasks" && <TasksView />}
              {tab === "code" && <CodeView conv={conv} onAsk={() => setTab("assistant")} />}
              {tab === "composer" && <ComposerView />}
              {tab === "integrations" && <IntegrationsView />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
