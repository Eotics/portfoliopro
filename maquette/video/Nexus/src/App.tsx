import {
  Activity, Bot, CalendarDays, FolderKanban, FolderOpen, Globe, House, ListChecks, MessageSquare,
  MonitorPlay, OctagonX, Palette, Play, Settings as SettingsIcon, ShieldCheck, Workflow,
} from "lucide-react";
import { Component, type ReactNode } from "react";
import { ApprovalDock } from "./components/Approval";
import { Dot, cx, statusMeta } from "./components/ui";
import { api, type Mode } from "./lib/api";
import { useL, useNexus, type Page } from "./lib/store";
import ActivityPage from "./pages/Activity";
import BrowserPage from "./pages/Browser";
import CalendarPage from "./pages/Calendar";
import ChatPage from "./pages/Chat";
import ControlPage from "./pages/Control";
import FilesPage from "./pages/Files";
import HomePage from "./pages/Home";
import PermissionsPage from "./pages/Permissions";
import ProjectsPage from "./pages/Projects";
import SettingsPage from "./pages/Settings";
import TasksPage from "./pages/Tasks";
import AutomationsPage from "./pages/Automations";
import StudioPage from "./studio/Studio";

const NAV: { id: Page; icon: typeof House; fr: string; en: string }[] = [
  { id: "home", icon: House, fr: "Accueil", en: "Home" },
  { id: "chat", icon: MessageSquare, fr: "Chat", en: "Chat" },
  { id: "control", icon: MonitorPlay, fr: "Contrôle", en: "Control Panel" },
  { id: "studio", icon: Palette, fr: "Studio Companion", en: "Companion Studio" },
  { id: "tasks", icon: ListChecks, fr: "Tâches", en: "Tasks" },
  { id: "calendar", icon: CalendarDays, fr: "Calendrier", en: "Calendar" },
  { id: "projects", icon: FolderKanban, fr: "Projets", en: "Projects" },
  { id: "files", icon: FolderOpen, fr: "Fichiers", en: "Files" },
  { id: "browser", icon: Globe, fr: "Navigateur", en: "Browser" },
  { id: "automations", icon: Workflow, fr: "Automatisations", en: "Automations" },
  { id: "activity", icon: Activity, fr: "Activité", en: "Activity" },
  { id: "permissions", icon: ShieldCheck, fr: "Permissions", en: "Permissions" },
  { id: "settings", icon: SettingsIcon, fr: "Paramètres", en: "Settings" },
];

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="glass m-6 border-bad/40 p-5">
          <div className="font-semibold text-bad">This page crashed</div>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-mute">{this.state.error.message}</pre>
        </div>
      );
    return this.props.children;
  }
}

export function ModeSwitch({ size = "md" }: { size?: "sm" | "md" }) {
  const { state, run, refresh } = useNexus();
  const L = useL();
  const modes: { id: Mode; label: string; hint: string }[] = [
    { id: "MANUAL", label: L("MANUEL", "MANUAL"), hint: L("Vous contrôlez ; NEXUS observe seulement", "You control; NEXUS only observes") },
    { id: "AI", label: "IA", hint: L("NEXUS agit via les outils autorisés", "NEXUS acts through approved tools") },
    { id: "COPILOT", label: "CO-PILOT", hint: L("Chaque action demande votre accord", "Every action needs your confirmation") },
  ];
  return (
    <div className="flex rounded-lg border border-line bg-black/25 p-0.5">
      {modes.map((m) => (
        <button key={m.id} title={m.hint}
          onClick={() => run(api.setMode(m.id)).then(refresh)}
          className={cx("rounded-md font-semibold tracking-wider transition-colors", size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]",
            state?.mode === m.id ? "bg-white/12 text-fg shadow-inner" : "text-mute hover:text-fg")}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function StopButton({ big }: { big?: boolean }) {
  const { state, run, refresh } = useNexus();
  const L = useL();
  if (state?.stopped)
    return (
      <button onClick={() => run(api.rearm(), L("NEXUS réarmé", "NEXUS re-armed")).then(refresh)}
        className={cx("inline-flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 font-semibold tracking-wide text-ok hover:bg-ok/20", big ? "h-11 px-5 text-sm" : "h-9 px-3.5 text-xs")}>
        <Play className="h-4 w-4" /> {L("RÉARMER NEXUS", "RE-ARM NEXUS")}
      </button>
    );
  return (
    <button onClick={() => run(api.stop()).then(refresh)} title="Ctrl+Alt+Backspace"
      className={cx("inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-[#ff5d6e] to-[#d63447] font-bold tracking-[0.08em] text-white shadow-[0_8px_30px_-8px_rgb(255_80_100/0.7)] ring-1 ring-white/15 hover:brightness-110 active:scale-[0.98]",
        big ? "h-11 px-6 text-sm" : "h-9 px-4 text-xs")}>
      <OctagonX className="h-4 w-4" /> STOP NEXUS
    </button>
  );
}

function CompanionToggle() {
  const { run, settings } = useNexus();
  const L = useL();
  if (settings && !settings.companionEnabled) return null;
  return (
    <button onClick={() => run(api.companionToggle())} title={L("Afficher / masquer le Companion", "Show / hide the Companion")}
      className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-black/20 text-mute hover:text-fg">
      <Bot className="h-4 w-4" />
    </button>
  );
}

function TopBar() {
  const { state, lang } = useNexus();
  const s = state ? statusMeta[state.status] : statusMeta.IDLE;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-black/20 px-3 py-1.5">
        <Dot color={s.color} pulse={s.busy} />
        <span className="text-[12px] font-semibold tracking-wide" style={{ color: s.color }}>{lang === "en" ? s.en : s.fr}</span>
        {state?.pendingApprovals ? <span className="rounded bg-warn/20 px-1.5 text-[10px] font-bold text-warn">{state.pendingApprovals}</span> : null}
      </div>
      <div className="hidden text-xs text-dim md:block">{state?.aiConfigured ? state.model : "AI not configured"}</div>
      <div className="ml-auto flex items-center gap-3">
        <CompanionToggle />
        <ModeSwitch />
        <StopButton />
      </div>
    </header>
  );
}

function Toasts() {
  const { toasts } = useNexus();
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx("glass fade-up pointer-events-auto max-w-xl bg-ink-2/95 px-4 py-2.5 text-[13px] shadow-xl",
          t.kind === "error" ? "border-bad/40 text-bad" : t.kind === "ok" ? "border-ok/30 text-ok" : "text-fg")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { page, go, lang, settings, state } = useNexus();
  const L = useL();
  const pages: Record<Page, ReactNode> = {
    home: <HomePage />, chat: <ChatPage />, control: <ControlPage />, studio: <StudioPage />, tasks: <TasksPage />, calendar: <CalendarPage />,
    projects: <ProjectsPage />, files: <FilesPage />, browser: <BrowserPage />, automations: <AutomationsPage />,
    activity: <ActivityPage />, permissions: <PermissionsPage />, settings: <SettingsPage />,
  };
  return (
    <div className={cx("flex h-full", settings && !settings.animations && "no-anim")}>
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-black/20 max-lg:w-[64px]">
        <div className="flex h-14 items-center gap-2.5 px-4 max-lg:justify-center max-lg:px-0">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sky to-violet text-ink shadow-[0_4px_20px_-4px_rgb(139_125_255/0.7)]">
            <Bot className="h-4.5 w-4.5" />
          </div>
          <div className="max-lg:hidden">
            <div className="font-display text-[15px] font-bold tracking-[0.2em]">NEXUS</div>
            <div className="-mt-0.5 text-[9.5px] tracking-wide text-dim">{L("Votre ordinateur. Votre agent.", "Your computer. Your agent.")}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => go(n.id)} title={lang === "en" ? n.en : n.fr}
              className={cx("group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors max-lg:justify-center",
                page === n.id ? "bg-white/[0.07] text-fg" : "text-mute hover:bg-white/[0.035] hover:text-fg")}>
              <n.icon className={cx("h-4 w-4 shrink-0", page === n.id ? "text-sky" : "text-dim group-hover:text-mute")} />
              <span className="truncate max-lg:hidden">{lang === "en" ? n.en : n.fr}</span>
              {n.id === "chat" && state?.agentRunning && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sky pulse max-lg:hidden" />}
            </button>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-[10px] leading-relaxed text-dim max-lg:hidden">
          {L("Votre contrôle.", "Your control.")} <span className="font-mono">Ctrl+Alt+⌫</span> = STOP
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {state?.stopped && (
          <div className="flex items-center gap-3 border-b border-bad/30 bg-bad/10 px-5 py-2 text-[13px] text-bad">
            <OctagonX className="h-4 w-4" />
            {L("NEXUS est arrêté : aucune action automatisée ne peut s'exécuter. Réarmez-le ou envoyez une nouvelle demande.",
               "NEXUS is stopped: no automated action can run. Re-arm it or send a new request.")}
          </div>
        )}
        <main className={cx("min-h-0 flex-1", page === "chat" || page === "control" || page === "studio" ? "overflow-hidden" : "overflow-y-auto")}>
          <Boundary resetKey={page}>
            <div key={page} className={cx("fade-up h-full", page !== "chat" && page !== "control" && page !== "studio" && "mx-auto max-w-[1500px] p-6")}>{pages[page]}</div>
          </Boundary>
        </main>
      </div>
      <ApprovalDock />
      <Toasts />
    </div>
  );
}
