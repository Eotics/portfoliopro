import {
  Camera, Check, Crosshair, Expand, Keyboard, Maximize2, Monitor, MousePointer2, Pause, Play, RefreshCw, Type, X, ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as RKE, type MouseEvent as RME, type WheelEvent as RWE } from "react";
import { Button, Dot, Input, Select, Toggle, cx } from "../components/ui";
import { api, errMsg, type Frame, type Highlight, type MonitorInfo } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

type Zoom = "fit" | "1" | "2";
const QUALITY = {
  low: { w: 960, q: 50 },
  medium: { w: 1600, q: 70 },
  high: { w: 3840, q: 82 },
} as const;
type Quality = keyof typeof QUALITY;

const MOD_KEYS = ["ctrl", "alt", "shift", "win"] as const;
type Mod = (typeof MOD_KEYS)[number];

function domKeyName(e: RKE): string | null {
  const map: Record<string, string> = {
    " ": "space", Enter: "enter", Escape: "esc", Tab: "tab", Backspace: "backspace", Delete: "delete",
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end",
    PageUp: "pageup", PageDown: "pagedown", Insert: "insert", ContextMenu: "apps",
  };
  if (map[e.key]) return map[e.key]!;
  if (/^F\d{1,2}$/.test(e.key)) return e.key.toLowerCase();
  if (e.code.startsWith("Key")) return e.code.slice(3).toLowerCase();
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  return null;
}

export default function ControlPage() {
  const { state, run, toast } = useNexus();
  const L = useL();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [mon, setMon] = useState(1);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [live, setLive] = useState(true);
  const [fpsTarget, setFpsTarget] = useState(5);
  const [quality, setQuality] = useState<Quality>("medium");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [interact, setInteract] = useState(false);
  const [kbd, setKbd] = useState(false);
  const [mods, setMods] = useState<Set<Mod>>(new Set());
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [fps, setFps] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [typeBuf, setTypeBuf] = useState("");
  const [hl, setHl] = useState<Highlight | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const press = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const frames = useRef<number[]>([]);

  const monitor = monitors.find((m) => m.index === mon);

  useEffect(() => {
    api.listMonitors().then((m) => { setMonitors(m); if (!m.some((x) => x.index === mon) && m[0]) setMon(m[0].index); }).catch((e) => setErr(errMsg(e)));
    api.getHighlight().then(setHl).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEvent<Highlight | null>("nexus://highlight", (h) => setHl(h));

  // Self-throttling capture loop: request the next frame only after the previous one arrived.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      const t0 = performance.now();
      try {
        const q = QUALITY[quality];
        const [f, c] = await Promise.all([api.captureFrame(mon, q.w, q.q), api.cursor()]);
        if (cancelled) return;
        setFrame(f);
        setCursor(c);
        setErr(null);
        const now = performance.now();
        frames.current = [...frames.current.filter((t) => now - t < 2000), now];
        setFps(frames.current.length / 2);
      } catch (e) {
        if (!cancelled) setErr(errMsg(e));
      }
      if (cancelled) return;
      const wait = Math.max(0, 1000 / fpsTarget - (performance.now() - t0));
      timer = window.setTimeout(tick, wait);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [live, mon, quality, fpsTarget]);

  const refreshOnce = async () => {
    const q = QUALITY[quality];
    const f = await run(api.captureFrame(mon, q.w, q.q));
    if (f) setFrame(f);
  };

  const frac = useCallback((e: RME | RWE) => {
    const r = img.current!.getBoundingClientRect();
    return { fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }, []);

  const withMods = async (fn: () => Promise<unknown>) => {
    const held = [...mods];
    for (const m of held) await api.key(m, "down");
    try { await fn(); } finally { for (const m of held.reverse()) await api.key(m, "up"); }
    if (held.length) setMods(new Set());
  };

  const onMove = (e: RME) => {
    if (!monitor || !img.current) return;
    const { fx, fy } = frac(e);
    setHover({ x: Math.round(monitor.x + fx * monitor.width), y: Math.round(monitor.y + fy * monitor.height) });
  };

  // The real cursor is only moved on release, so the pointer stays over the preview:
  // a short press is a click, a longer movement is a drag.
  const onDown = (e: RME) => {
    if (!interact || e.button !== 0) return;
    e.preventDefault();
    const { fx, fy } = frac(e);
    press.current = { fx, fy, cx: e.clientX, cy: e.clientY };
  };
  const onUp = (e: RME) => {
    const p = press.current;
    press.current = null;
    if (!interact || e.button !== 0 || !p) return;
    const { fx, fy } = frac(e);
    const moved = Math.hypot(e.clientX - p.cx, e.clientY - p.cy) > 5;
    const act = moved ? () => api.drag(mon, p.fx, p.fy, fx, fy) : () => api.mouse(mon, fx, fy, "click");
    void withMods(act).catch((x) => toast(errMsg(x), "error"));
  };
  const onAux = (e: RME) => {
    if (!interact || e.button !== 1) return;
    e.preventDefault();
    const { fx, fy } = frac(e);
    api.mouse(mon, fx, fy, "middle").catch((x) => toast(errMsg(x), "error"));
  };
  const onContext = (e: RME) => {
    if (!interact) return;
    e.preventDefault();
    const { fx, fy } = frac(e);
    void withMods(() => api.mouse(mon, fx, fy, "right")).catch((x) => toast(errMsg(x), "error"));
  };
  const onWheel = (e: RWE) => {
    if (!interact) return;
    const { fx, fy } = frac(e);
    const notches = Math.max(-5, Math.min(5, Math.round(-e.deltaY / 100) || (e.deltaY > 0 ? -1 : 1)));
    api.scroll(mon, fx, fy, notches).catch(() => {});
  };
  const onKey = (e: RKE) => {
    if (!kbd) return;
    if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) return;
    e.preventDefault();
    const ctrl = e.ctrlKey && !e.getModifierState("AltGraph");
    if (e.key.length === 1 && !ctrl && !e.altKey && !e.metaKey && mods.size === 0) {
      api.typeText(e.key).catch((x) => toast(errMsg(x), "error"));
      return;
    }
    const name = domKeyName(e);
    if (!name) return;
    const combo = [...(ctrl ? ["ctrl"] : []), ...(e.altKey ? ["alt"] : []), ...(e.shiftKey ? ["shift"] : []), ...mods, name];
    const uniq = [...new Set(combo)];
    (uniq.length === 1 ? api.key(name) : api.hotkey(uniq)).catch((x) => toast(errMsg(x), "error"));
    if (mods.size) setMods(new Set());
  };

  const pressKey = (k: string) => {
    const combo = [...mods, k];
    (combo.length === 1 ? api.key(k) : api.hotkey(combo)).then(() => setMods(new Set())).catch((x) => toast(errMsg(x), "error"));
  };
  const toggleMod = (m: Mod) => setMods((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  const imgStyle = (() => {
    if (!frame || !monitor || zoom === "fit") return { maxWidth: "100%", maxHeight: "100%" };
    return { width: `${monitor.width * Number(zoom) / (window.devicePixelRatio || 1)}px`, maxWidth: "none" as const };
  })();

  const cursorOnFrame = cursor && monitor && cursor[0] >= monitor.x && cursor[0] < monitor.x + monitor.width && cursor[1] >= monitor.y && cursor[1] < monitor.y + monitor.height
    ? { left: `${((cursor[0] - monitor.x) / monitor.width) * 100}%`, top: `${((cursor[1] - monitor.y) / monitor.height) * 100}%` }
    : null;

  const sameMonitorWarning = monitors.length > 1 ? null : L(
    "Un seul écran : l'aperçu inclut la fenêtre NEXUS elle-même (effet miroir). Les clics atterrissent là où ils pointent sur l'écran réel.",
    "Single monitor: the preview includes the NEXUS window itself (mirror effect). Clicks land where they point on the real screen.",
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="font-display text-[15px] font-semibold tracking-[0.12em]">{L("PANNEAU DE CONTRÔLE", "CONTROL PANEL")}</div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider">
          <Dot color={err ? "#ff6b7a" : live ? "#4ade9b" : "#8d96a8"} pulse={live && !err} />
          <span className={err ? "text-bad" : live ? "text-ok" : "text-mute"}>{err ? L("ERREUR", "ERROR") : live ? L("EN DIRECT", "LIVE") : L("EN PAUSE", "PAUSED")}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-4 max-lg:w-48">
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Écrans", "Monitors")}</div>
            <div className="space-y-1.5">
              {monitors.map((m) => (
                <button key={m.index} onClick={() => setMon(m.index)}
                  className={cx("w-full rounded-lg border px-3 py-2 text-left transition-colors", m.index === mon ? "border-sky/40 bg-sky/[0.07]" : "border-line hover:border-line-2")}>
                  <div className="flex items-center gap-2 text-[12.5px] font-medium">
                    <Monitor className={cx("h-3.5 w-3.5", m.index === mon ? "text-sky" : "text-dim")} />
                    {L("Écran", "Monitor")} {m.index}{m.primary && <span className="text-[10px] text-dim">· {L("principal", "primary")}</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-dim">{m.width}×{m.height} · {Math.round(m.scaleFactor * 100)}%</div>
                </button>
              ))}
              {monitors.length === 0 && <div className="text-xs text-mute">{err ?? "…"}</div>}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Flux", "Stream")}</div>
            <label className="flex items-center justify-between text-[12px] text-fg/85">{L("Qualité", "Quality")}
              <Select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} className="h-7 text-xs">
                <option value="low">{L("Basse", "Low")}</option><option value="medium">{L("Moyenne", "Medium")}</option><option value="high">{L("Native", "Native")}</option>
              </Select>
            </label>
            <label className="flex items-center justify-between text-[12px] text-fg/85">{L("Images/s", "FPS")}
              <Select value={fpsTarget} onChange={(e) => setFpsTarget(Number(e.target.value))} className="h-7 text-xs">
                {[1, 2, 5, 10, 15].map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </label>
          </div>

          <div className="space-y-2.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Contrôle manuel", "Manual control")}</div>
            <label className="flex items-center justify-between gap-2 text-[12px] text-fg/85">
              <span className="flex items-center gap-1.5"><MousePointer2 className="h-3.5 w-3.5 text-dim" />{L("Souris réelle", "Real mouse")}</span>
              <Toggle checked={interact} onChange={setInteract} />
            </label>
            <label className="flex items-center justify-between gap-2 text-[12px] text-fg/85">
              <span className="flex items-center gap-1.5"><Keyboard className="h-3.5 w-3.5 text-dim" />{L("Capturer le clavier", "Capture keyboard")}</span>
              <Toggle checked={kbd} onChange={(v) => { setKbd(v); if (v) viewer.current?.focus(); }} />
            </label>
            <p className="text-[10.5px] leading-relaxed text-dim">
              {L("Cliquez dans l'aperçu pour cliquer sur le vrai bureau (double-clic, glisser, molette et clic droit aussi). Le clavier est envoyé à la fenêtre que vous utilisiez avant NEXUS.",
                 "Click in the preview to click the real desktop (double-click, drag, wheel and right click too). Keys go to the window you were using before NEXUS.")}
            </p>
          </div>
          {sameMonitorWarning && <p className="rounded-lg border border-line bg-black/20 p-2 text-[10.5px] leading-relaxed text-dim">{sameMonitorWarning}</p>}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={viewer}
            tabIndex={0}
            onKeyDown={onKey}
            className={cx("relative min-h-0 flex-1 overflow-auto bg-black/40 outline-none", kbd && "ring-1 ring-inset ring-sky/40", zoom === "fit" ? "grid place-items-center p-4" : "p-2")}
          >
            {frame ? (
              <div className="relative inline-block leading-none">
                <img
                  ref={img}
                  src={`data:${frame.mediaType};base64,${frame.data}`}
                  draggable={false}
                  onMouseMove={onMove}
                  onMouseLeave={() => { setHover(null); press.current = null; }}
                  onMouseDown={onDown}
                  onMouseUp={onUp}
                  onAuxClick={onAux}
                  onContextMenu={onContext}
                  onWheel={onWheel}
                  style={imgStyle}
                  className={cx("block select-none rounded-md shadow-[0_20px_60px_-20px_rgb(0_0_0/0.9)] ring-1 ring-white/10", interact ? "cursor-crosshair" : "cursor-default")}
                  alt={`Monitor ${mon}`}
                />
                {cursorOnFrame && (
                  <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={cursorOnFrame}>
                    <div className="h-4 w-4 rounded-full border-2 border-sky bg-sky/25 shadow-[0_0_12px_rgb(143_211_255/0.8)]" />
                  </div>
                )}
                {hl && hl.monitor === mon && (
                  <div className="pointer-events-none absolute" style={{ left: `${(hl.x - hl.w / 2) * 100}%`, top: `${(hl.y - hl.h / 2) * 100}%`, width: `${hl.w * 100}%`, height: `${hl.h * 100}%` }}>
                    <div className="hl-box h-full w-full rounded-md" />
                    <div className="absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-warn px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-ink shadow-lg">{hl.label}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[13px] text-mute">{err ? <span className="text-bad">{err}</span> : L("Connexion à l'écran…", "Connecting to screen…")}</div>
            )}
          </div>

          {hl && (
            <div className="flex flex-wrap items-center gap-3 border-t border-warn/30 bg-warn/[0.06] px-4 py-2.5">
              <Crosshair className="h-4 w-4 text-warn" />
              <div className="min-w-0 flex-1 text-[12.5px]">
                <span className="font-semibold text-warn">{L("Suggestion de NEXUS", "NEXUS suggests")}:</span>{" "}
                <span className="text-fg/90">{hl.label}</span>{" "}
                <span className="font-mono text-[11px] text-dim">({hl.screenX}, {hl.screenY}) · {L("écran", "monitor")} {hl.monitor}</span>
              </div>
              <Button size="sm" variant="ok" icon={<Check className="h-3.5 w-3.5" />} onClick={() => run(api.executeHighlight(), L("Clic exécuté", "Click executed"))}>{L("Cliquer ici", "Click here")}</Button>
              <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => run(api.clearHighlight())}>{L("Ignorer", "Dismiss")}</Button>
            </div>
          )}

          <div className="border-t border-line bg-black/25 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => setLive(!live)}>{live ? L("Pause", "Pause") : L("Reprendre", "Resume")}</Button>
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={refreshOnce}>{L("Rafraîchir", "Refresh")}</Button>
              <div className="flex rounded-lg border border-line bg-black/25 p-0.5">
                {(["fit", "1", "2"] as Zoom[]).map((z) => (
                  <button key={z} onClick={() => setZoom(z)} className={cx("rounded-md px-2 py-1 text-[11px] font-medium", zoom === z ? "bg-white/12 text-fg" : "text-mute hover:text-fg")}>
                    {z === "fit" ? <span className="inline-flex items-center gap-1"><Maximize2 className="h-3 w-3" />{L("Ajuster", "Fit")}</span> : <span className="inline-flex items-center gap-1"><ZoomIn className="h-3 w-3" />{z === "1" ? "100%" : "200%"}</span>}
                  </button>
                ))}
              </div>
              <Button size="sm" icon={<Expand className="h-3.5 w-3.5" />} onClick={() => viewer.current?.requestFullscreen().catch(() => {})}>{L("Plein écran", "Fullscreen")}</Button>
              <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} onClick={async () => { const p = await run(api.screenshotToFile(mon)); if (p) toast(`${L("Capture enregistrée", "Screenshot saved")}: ${p}`, "ok"); }}>{L("Capture", "Screenshot")}</Button>
              <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-mute">
                <span>{L("Souris", "Mouse")}: X {cursor?.[0] ?? "—"} Y {cursor?.[1] ?? "—"}</span>
                {hover && <span className="text-dim">{L("Pointeur", "Pointer")}: {hover.x}, {hover.y}</span>}
                <span>{monitor ? `${monitor.width}×${monitor.height}` : ""}</span>
                <span>{fps.toFixed(1)} fps{frame ? ` · ${frame.captureMs} ms` : ""}</span>
                <span className={kbd ? "text-sky" : ""}>{L("Clavier", "Keyboard")}: {kbd ? L("capturé", "captured") : L("prêt", "ready")}</span>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {MOD_KEYS.map((m) => (
                <button key={m} onClick={() => toggleMod(m)}
                  className={cx("h-7 rounded-md border px-2.5 font-mono text-[11px] font-semibold uppercase", mods.has(m) ? "border-sky/60 bg-sky/20 text-sky" : "border-line bg-white/[0.04] text-fg/85 hover:bg-white/10")}>
                  {m}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-line" />
              {["enter", "esc", "tab", "backspace", "delete", "left", "up", "down", "right", "home", "end"].map((k) => (
                <button key={k} onClick={() => pressKey(k)} className="h-7 rounded-md border border-line bg-white/[0.04] px-2 font-mono text-[11px] text-fg/85 hover:bg-white/10">
                  {{ left: "←", right: "→", up: "↑", down: "↓" }[k] ?? k.toUpperCase()}
                </button>
              ))}
              <Select className="h-7 font-mono text-[11px]" value="" onChange={(e) => { if (e.target.value) pressKey(e.target.value); }}>
                <option value="">F1–F12</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={`f${i + 1}`}>F{i + 1}</option>)}
              </Select>
              <span className="mx-1 h-5 w-px bg-line" />
              {[["alt", "tab"], ["win", "d"], ["ctrl", "c"], ["ctrl", "v"], ["ctrl", "z"], ["ctrl", "shift", "esc"]].map((c) => (
                <button key={c.join("+")} onClick={() => run(api.hotkey(c))} className="h-7 rounded-md border border-line bg-white/[0.04] px-2 font-mono text-[11px] text-fg/85 hover:bg-white/10">
                  {c.map((x) => x[0]!.toUpperCase() + x.slice(1)).join("+")}
                </button>
              ))}
              <div className="ml-auto flex min-w-[260px] flex-1 items-center gap-1.5 lg:max-w-md">
                <Input value={typeBuf} onChange={(e) => setTypeBuf(e.target.value)} placeholder={L("Texte à taper dans la fenêtre active…", "Text to type in the active window…")} className="h-7 text-xs"
                  onKeyDown={(e) => { if (e.key === "Enter" && typeBuf) { run(api.typeText(typeBuf)).then(() => setTypeBuf("")); } }} />
                <Button size="sm" icon={<Type className="h-3.5 w-3.5" />} disabled={!typeBuf} onClick={() => run(api.typeText(typeBuf)).then(() => setTypeBuf(""))}>{L("Taper", "Type")}</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {state?.mode === "AI" && (
        <div className="border-t border-line px-5 py-1.5 text-[10.5px] text-dim">
          {L("Mode IA : NEXUS peut agir via ses outils ; vous gardez la main ici à tout moment.", "AI mode: NEXUS may act through its tools; you can take over here at any time.")}
        </div>
      )}
    </div>
  );
}
