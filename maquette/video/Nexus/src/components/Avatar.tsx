// Real-time layered renderer for the NEXUS Companion. Every equipped asset is
// its own positioned <img>; nothing is flattened.
//
// Life comes from several independent, desynchronised layers of motion (see
// styles.css "nxl-*"): body breathing, head micro-tilt, arm sway, effects
// drift; plus randomly timed blinks and small spontaneous reactions. The state
// (the real NEXUS status) selects the mood of each layer.
import { memo, useEffect, useMemo, useState } from "react";
import { useLayerImage } from "../lib/assets";
import { animationFor, expressionFor, sortedLayers, type AssetDef, type CompanionState, type Layer, type Look, type SlotDef } from "../lib/look";
import { cx } from "./ui";

export function layerBox(layer: Layer, asset: AssetDef | undefined) {
  const base = asset?.size ?? 200;
  const w = base * layer.scale;
  return { left: 100 + layer.x - w / 2, top: 100 + layer.y - w / 2, w };
}

/** How much each slot follows the gaze (eyes fully, the rest of the face a little). */
const GAZE: Record<string, number> = { eyes: 1, mouth: 0.6, face: 0.6, glasses: 0.8 };

/** Motion group of each slot: parts of the head move together, etc. */
const GROUP: Record<string, string> = {
  body: "body", legs: "body", shoes: "body", body_accessories: "body", neck: "body",
  eyes: "head", mouth: "head", face: "head", glasses: "head", headwear: "head", ears: "head", horns: "head", status: "head",
  arms: "arms", wings: "wings", tail: "tail", back: "body",
  aura: "aura", effects: "fx", particles: "fx", lighting: "aura", pet: "pet",
};
/** Expressions where the eyes are already closed/curved: no blinking. */
const NO_BLINK = new Set(["happy", "sleepy", "proud", "dizzy"]);
const IDLE_REACTIONS = ["glance", "tilt", "wiggle", "hop", "blink2", "glance", "tilt"];

const LayerView = memo(function LayerView({ layer, asset, expression, selected, expressive, gx, gy }: {
  layer: Layer; asset: AssetDef | undefined; expression: string; selected: boolean; expressive: boolean; gx: number; gy: number;
}) {
  const img = useLayerImage(layer, asset, expressive ? expression : undefined);
  const box = layerBox(layer, asset);
  const k = GAZE[layer.slot] ?? 0;
  const ax = (asset?.anchor?.x ?? 0.5) * 100, ay = (asset?.anchor?.y ?? 0.5) * 100;
  const tint = img.raster && asset?.tintable && layer.colors.primary;
  return (
    <div
      data-uid={layer.uid}
      className="pointer-events-none absolute"
      style={{
        left: box.left + gx * k, top: box.top + gy * k, width: box.w, height: box.w, opacity: layer.opacity,
        transform: `rotate(${layer.rotation}deg) scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`,
        transformOrigin: `${ax}% ${ay}%`,
      }}
    >
      <div className={cx("nxl-a h-full w-full", `nxl-${GROUP[layer.slot] ?? "other"}`)}><div className="nxl-b h-full w-full">
      {img.url ? (
        <>
          <img src={img.url} alt="" draggable={false} className={cx("h-full w-full select-none object-contain", layer.slot === "eyes" && "nx-eyelid")} />
          {tint && (
            // Raster tint: recolour while keeping the image's shading.
            <div className="absolute inset-0" style={{
              background: layer.colors.primary, mixBlendMode: "color",
              WebkitMaskImage: `url("${img.url}")`, maskImage: `url("${img.url}")`,
              WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center",
            }} />
          )}
        </>
      ) : img.error && img.error !== "null" ? (
        <div className="grid h-full w-full place-items-center rounded border border-dashed border-bad/50 text-[9px] text-bad/80">?</div>
      ) : null}
      </div></div>
      {selected && <div className="absolute inset-0 rounded-sm outline outline-1 outline-offset-1 outline-sky/80" />}
    </div>
  );
});

export function Avatar({ look, assets, slots, state = "IDLE", size = 96, motion = "full", selected, previewExpression, animation, gaze, className }: {
  look: Look;
  assets: Map<string, AssetDef>;
  slots: SlotDef[];
  state?: CompanionState;
  size?: number;
  motion?: "full" | "subtle" | "off";
  selected?: string | null;
  previewExpression?: string;
  /** Overrides the state's animation (e.g. a reaction to being petted). */
  animation?: string;
  /** Eye offset on the 200-unit canvas, e.g. to look at the mouse. */
  gaze?: { x: number; y: number };
  className?: string;
}) {
  const expression = previewExpression ?? expressionFor(look, state);
  const anim = animation ?? animationFor(look, state);
  const alive = motion !== "off";
  const blink = useBlink(alive && state !== "SLEEPING" && state !== "STOPPED" && !NO_BLINK.has(expression));
  const reaction = useIdleReactions(alive && motion === "full" && (state === "IDLE" || state === "LISTENING"));
  const glance = reaction?.startsWith("glance") ? GLANCES[Number(reaction.slice(6)) % GLANCES.length]! : null;
  const gx = Math.round(((gaze?.x ?? 0) + (glance?.x ?? 0)) * 2) / 2, gy = Math.round(((gaze?.y ?? 0) + (glance?.y ?? 0)) * 2) / 2;
  const expressive = new Set(slots.filter((s) => s.expressive).map((s) => s.id));
  // Per-instance timings so two companions (or two layers) never move in lockstep.
  const vars = useMemo(() => {
    const r = (a: number, b: number) => (a + Math.random() * (b - a)).toFixed(2);
    return { "--nx-breathe": `${r(3.4, 4.3)}s`, "--nx-tilt": `${r(6.4, 8.6)}s`, "--nx-sway": `${r(4.6, 6.2)}s`, "--nx-fx": `${r(7, 11)}s`, "--nx-delay": `-${r(0, 6)}s` } as React.CSSProperties;
  }, []);
  return (
    <div className={cx("relative shrink-0", className)} style={{ width: size, height: size, ...vars }} role="img" aria-label={`Companion · ${state}`}
      data-st={state} data-blink={blink ? "1" : undefined} data-react={reaction ?? undefined}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: 200, height: 200, transform: `scale(${size / 200})` }}>
        <div className={cx("nx-anim relative h-full w-full", alive && `nx-anim-${anim}`, motion === "subtle" && "nx-anim-subtle", !alive && "nx-still")}>
          {sortedLayers(look).filter((l) => !l.hidden).map((l) => (
            <LayerView key={l.uid} layer={l} asset={assets.get(l.assetId)} expression={expression} selected={selected === l.uid} expressive={expressive.has(l.slot)} gx={gx} gy={gy} />
          ))}
        </div>
      </div>
    </div>
  );
}

const GLANCES = [{ x: -3, y: -1 }, { x: 3, y: -1.5 }, { x: 2, y: 1 }, { x: -2.5, y: 0.5 }];

/** Blinks at irregular intervals (1.6-5.6 s), sometimes twice in a row. */
function useBlink(enabled: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) { setClosed(false); return; }
    let t: number | undefined;
    let alive = true;
    const blinkOnce = (then: () => void) => {
      setClosed(true);
      t = window.setTimeout(() => { if (!alive) return; setClosed(false); then(); }, 110 + Math.random() * 50);
    };
    const schedule = () => {
      t = window.setTimeout(() => {
        if (!alive) return;
        const twice = Math.random() < 0.15;
        blinkOnce(() => (twice ? (t = window.setTimeout(() => alive && blinkOnce(schedule), 140)) : schedule()));
      }, 1600 + Math.random() * 4000);
    };
    schedule();
    return () => { alive = false; clearTimeout(t); };
  }, [enabled]);
  return closed;
}

/** A small spontaneous reaction every 6-16 s while idle (never the same rhythm twice). */
function useIdleReactions(enabled: boolean) {
  const [r, setR] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) { setR(null); return; }
    let t: number | undefined;
    let alive = true;
    const next = () => {
      t = window.setTimeout(() => {
        if (!alive) return;
        const kind = IDLE_REACTIONS[Math.floor(Math.random() * IDLE_REACTIONS.length)]!;
        const pick = kind === "glance" ? `glance${Math.floor(Math.random() * GLANCES.length)}` : kind;
        setR(pick);
        t = window.setTimeout(() => { if (!alive) return; setR(null); next(); }, kind === "glance" ? 1400 + Math.random() * 900 : 1300);
      }, 6000 + Math.random() * 10000);
    };
    next();
    return () => { alive = false; clearTimeout(t); };
  }, [enabled]);
  return r;
}
