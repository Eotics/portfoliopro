// "Pet" mode: only the creature floats on the desktop (transparent window).
// Every reaction comes from a real input (mouse, clicks) or the real NEXUS
// state; nothing is scripted to fake activity.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Mic, MessageSquare, PhoneOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../components/ui";
import { api } from "../lib/api";
import type { CompanionState, Look } from "../lib/look";
import { useL, useNexus } from "../lib/store";
import { studio } from "../lib/studioApi";
import { CompanionFigure } from "./Figure";
import type { useVoice } from "./useVoice";

type Reaction = null | { kind: "pet" | "dizzy" | "wake"; until: number };
const PET_SIZE = 170;

export function PetView({ state, look, motion, accent, title, bubble, alert, onOpen, voice, scale }: {
  state: CompanionState;
  look: Look | null;
  motion: "full" | "subtle" | "off";
  accent: string;
  title: string;
  bubble: string;
  /** Something needs the user (approval, error, stopped): keep the bubble visible. */
  alert: boolean;
  onOpen: (mode: "compact" | "expanded") => void;
  voice: ReturnType<typeof useVoice>;
  /** Creature size factor (small 0.8 / medium 1 / large 1.25). */
  scale: number;
}) {
  const petSize = Math.round(PET_SIZE * scale);
  const { run } = useNexus();
  const L = useL();
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [reaction, setReaction] = useState<Reaction>(null);
  const [hearts, setHearts] = useState<number[]>([]);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState(false);
  const [say, setSay] = useState<{ text: string; until: number } | null>(() => ({
    text: L("Coucou ! Double-clique sur moi pour me parler.", "Hi! Double-click me to talk."), until: Date.now() + 6000,
  }));
  const [, tick] = useState(0);
  const clicks = useRef<number[]>([]);
  const down = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  // Eyes follow the real mouse position anywhere on the desktop.
  useEffect(() => {
    if (motion === "off") return;
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      if (!document.hidden) {
        const c = await api.companionCursor().catch(() => null);
        if (c && alive) {
          const [dx, dy] = c;
          const d = Math.hypot(dx, dy) || 1;
          const m = Math.min(6, d / 45);
          setGaze((g) => {
            const n = { x: (dx / d) * m, y: (dy / d) * m * 0.7 };
            return Math.abs(n.x - g.x) < 0.25 && Math.abs(n.y - g.y) < 0.25 ? g : n;
          });
        }
      }
      if (alive) window.setTimeout(poll, 90);
    };
    void poll();
    return () => { alive = false; };
  }, [motion]);

  // Expire reactions / speech.
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      setReaction((r) => (r && r.until < now ? null : r));
      setSay((s) => (s && s.until < now ? null : s));
      tick((x) => x + 1);
    }, 400);
    return () => clearInterval(t);
  }, []);

  // Say something when the real state changes (not when idle).
  const lastState = useRef(state);
  useEffect(() => {
    if (state !== lastState.current && state !== "IDLE" && state !== "SLEEPING") setSay({ text: bubble, until: Date.now() + 5000 });
    lastState.current = state;
  }, [state, bubble]);

  const pet = () => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 3000), now];
    if (state === "SLEEPING") {
      setReaction({ kind: "wake", until: now + 2500 });
      setSay({ text: L("Hmm ? Je suis réveillé !", "Hmm? I'm awake!"), until: now + 3500 });
      return;
    }
    if (clicks.current.length >= 6) {
      clicks.current = [];
      setReaction({ kind: "dizzy", until: now + 2800 });
      setSay({ text: L("Ouh là… la tête me tourne !", "Whoa… I'm dizzy!"), until: now + 3500 });
      return;
    }
    setReaction({ kind: "pet", until: now + 1600 });
    setHearts((h) => [...h.slice(-5), now]);
    window.setTimeout(() => setHearts((h) => h.filter((x) => x !== now)), 1400);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(false);
    down.current = { x: e.screenX, y: e.screenY, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = down.current;
    if (!d || d.dragging || (e.buttons & 1) === 0) return;
    if (Math.hypot(e.screenX - d.x, e.screenY - d.y) > 4) {
      d.dragging = true;
      void getCurrentWindow().startDragging();
    }
  };
  const onPointerUp = () => {
    const d = down.current;
    down.current = null;
    if (d && !d.dragging) pet();
  };

  const r = reaction && reaction.until > Date.now() ? reaction : null;
  const busy = !["IDLE", "SLEEPING", "STOPPED"].includes(state);
  const figState: CompanionState = r?.kind === "wake" ? "IDLE" : state;
  const expression = voice.speaking ? "talking" : r?.kind === "pet" && !busy ? "happy" : r?.kind === "dizzy" ? "dizzy" : undefined;
  const animation = voice.speaking ? "breathe" : r?.kind === "pet" && !busy ? "pop" : r?.kind === "dizzy" ? "dizzy" : r?.kind === "wake" ? "bounce" : undefined;
  // Voice conversation first: what it hears, then what it answers.
  const speech = alert ? bubble
    : voice.recording ? L("Je t'écoute…", "I'm listening…")
    : voice.transcribing ? (voice.heard ? `« ${voice.heard} »` : "…")
    : voice.speaking ? voice.spoken
    : busy && voice.conversation && voice.heard ? `« ${voice.heard} »`
    : say && say.until > Date.now() ? say.text : null;

  return (
    <div className="relative flex h-full w-full select-none flex-col items-center justify-end overflow-hidden pb-2"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onContextMenu={(e) => { e.preventDefault(); setMenu((m) => !m); }}>
      {speech && (
        <button onClick={() => onOpen("compact")}
          className={cx("absolute left-1/2 top-2 max-w-[220px] -translate-x-1/2 rounded-2xl border px-3 py-1.5 text-center text-[11.5px] leading-snug text-fg shadow-[0_8px_24px_-8px_rgb(0_0_0/0.8)] backdrop-blur-md fade-up",
            alert && state === "ERROR" ? "border-bad/40 bg-[#2a0d14]/90" : alert ? "border-warn/40 bg-[#2a210d]/90" : "border-white/10 bg-[#121628]/90")}>
          <span className="line-clamp-4">{speech}</span>
        </button>
      )}

      <div className="relative" style={{ width: petSize, height: petSize }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDoubleClick={() => onOpen("compact")}>
        <CompanionFigure state={figState} size={petSize} fixedSize look={look} accent={accent} motion={motion} title={title}
          expression={expression} animation={animation} gaze={state === "SLEEPING" ? undefined : gaze} />
        {hearts.map((h, i) => (
          <span key={h} className="nx-heart pointer-events-none absolute text-[18px]" style={{ left: (60 + ((i * 37) % 60)) * scale, top: 30 * scale }}>♥</span>
        ))}
      </div>

      {voice.enabled && (
        <button onClick={voice.toggleConversation}
          title={voice.conversation ? L("Terminer la conversation (ou dis « au revoir »)", "End the conversation (or say \"goodbye\")") : L("Parler avec moi (conversation à la voix)", "Talk with me (voice conversation)")}
          className={cx("absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full border shadow-lg backdrop-blur-md transition-colors",
            voice.conversation ? "border-bad/50 bg-bad/25 text-bad" : "border-white/15 bg-[#121628]/90 text-sky hover:bg-[#1a2040]")}>
          {voice.conversation ? <PhoneOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {voice.recording && <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-[#5eead4]/70" style={{ transform: `scale(${1.05 + Math.min(0.5, voice.level * 5)})`, transition: "transform 90ms" }} />}
        </button>
      )}

      {hover && !menu && (
        <div className="absolute right-2 top-2 flex gap-1">
          <button onClick={() => onOpen("compact")} title={L("Parler à NEXUS", "Talk to NEXUS")} className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-[#121628]/90 text-mute hover:text-fg"><MessageSquare className="h-3.5 w-3.5" /></button>
          <button onClick={() => void run(api.companionHide())} title={L("Masquer (Ctrl+Alt+N pour revenir)", "Hide (Ctrl+Alt+N to bring back)")} className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-[#121628]/90 text-mute hover:text-bad"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {menu && (
        <div className="absolute inset-x-2 top-2 bottom-2 z-10 overflow-y-auto rounded-xl border border-white/10 bg-[#121628]/95 py-1 text-[11.5px] shadow-2xl backdrop-blur-md">
          {(([
            voice.enabled
              ? [voice.conversation ? L("Terminer la conversation", "End conversation") : L("Parler (vocal)", "Talk (voice)"), voice.toggleConversation]
              : [L("Activer le vocal…", "Enable voice…"), () => void run(api.showMain("settings"))],
            [L("Écrire à NEXUS", "Write to NEXUS"), () => onOpen("compact")],
            [L("Chat", "Chat"), () => void run(api.showMain("chat"))],
            [L("Studio", "Studio"), () => void run(api.showMain("studio"))],
            [L("Contrôle", "Control"), () => void run(api.showMain("control"))],
            [L("Paramètres", "Settings"), () => void run(api.showMain("settings"))],
            [L("Masquer", "Hide"), () => void run(api.companionHide())],
          ]) as [string, () => void][]).map(([label, fn]) => (
            <button key={label} onClick={() => { setMenu(false); fn(); }} className="block w-full px-3 py-1 text-left text-fg/90 hover:bg-white/[0.07]">{label}</button>
          ))}
          {look && (
            <div className="flex items-center gap-1 px-3 py-1 text-mute">
              {L("Taille", "Size")}
              {(["s", "m", "l"] as const).map((k) => (
                <button key={k} onClick={() => void run(studio.setLook({ ...look, size: k }))}
                  className={cx("ml-1 rounded px-1.5 py-0.5 text-[10.5px]", (look.size ?? "m") === k ? "bg-sky/20 text-sky" : "hover:bg-white/[0.07] hover:text-fg")}>{k === "s" ? L("P", "S") : k === "m" ? L("M", "M") : L("G", "L")}</button>
              ))}
            </div>
          )}
          <div className="my-1 h-px bg-white/10" />
          <button onClick={() => void run(api.appQuit())} className="block w-full px-3 py-1 text-left text-bad/90 hover:bg-bad/10">{L("Quitter NEXUS", "Quit NEXUS")}</button>
        </div>
      )}
    </div>
  );
}
