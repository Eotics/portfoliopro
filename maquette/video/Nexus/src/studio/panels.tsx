import {
  ArrowDown, ArrowUp, Copy, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Lock, MoreHorizontal, RotateCcw, Star, Trash2, Unlock, X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useLayerImage } from "../lib/assets";
import { COLOR_KEYS, hexToHsl, hexToRgb, parseColor, resolveColors, type AssetDef, type ColorKey, type Layer } from "../lib/look";
import { useL } from "../lib/store";
import { Button, Input, cx } from "../components/ui";

/** Thumbnail: data is only fetched once the card scrolls into view (then cached). */
export const AssetThumb = memo(function AssetThumb({ asset, size = 64 }: { asset: AssetDef; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: size, height: size }} className="grid place-items-center">
      {visible ? <ThumbImg asset={asset} /> : <div className="h-1/2 w-1/2 rounded-full bg-white/5" />}
    </div>
  );
});

function ThumbImg({ asset }: { asset: AssetDef }) {
  const img = useLayerImage({ assetId: asset.id, colors: {} }, asset);
  if (!asset.supported) return <span className="px-1 text-center text-[9px] text-warn">{asset.assetType}</span>;
  if (!img.url) return <div className="h-1/2 w-1/2 animate-pulse rounded-full bg-white/5" />;
  return <img src={img.url} alt="" draggable={false} className="h-full w-full object-contain" />;
}

export function AssetCard({ asset, equipped, onEquip, onFavorite, onMenu }: {
  asset: AssetDef; equipped: boolean; onEquip: () => void; onFavorite: () => void; onMenu: (e: React.MouseEvent) => void;
}) {
  const L = useL();
  return (
    <div className={cx("group relative flex flex-col items-center rounded-xl border p-1.5 transition-colors", equipped ? "border-sky/50 bg-sky/[0.07]" : "border-line bg-black/20 hover:border-line-2", !asset.supported && "opacity-60")}>
      <button className="w-full" onClick={onEquip} disabled={!asset.supported} title={asset.supported ? L("Équiper", "Equip") : asset.unsupportedReason ?? ""}>
        <div className="mx-auto rounded-lg bg-[radial-gradient(circle_at_50%_40%,rgb(255_255_255/0.06),transparent_70%)]"><AssetThumb asset={asset} size={72} /></div>
        <div className="mt-1 w-full truncate text-center text-[10.5px] text-fg/85">{asset.name}</div>
      </button>
      <button onClick={onFavorite} className={cx("absolute left-1 top-1 rounded p-0.5", asset.favorite ? "text-warn" : "text-dim opacity-0 group-hover:opacity-100")} aria-label="Favorite">
        <Star className="h-3 w-3" fill={asset.favorite ? "currentColor" : "none"} />
      </button>
      <button onClick={onMenu} className="absolute right-1 top-1 rounded p-0.5 text-dim opacity-0 hover:text-fg group-hover:opacity-100" aria-label={L("Actions", "Actions")}>
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {asset.custom && <span className="absolute bottom-6 right-1 rounded bg-violet/25 px-1 text-[8.5px] font-semibold text-violet">{L("MOI", "MINE")}</span>}
    </div>
  );
}

export function ColorField({ label, value, fallback, onChange, onReset }: { label: string; value?: string; fallback: string; onChange: (hex: string) => void; onReset: () => void }) {
  const L = useL();
  const shown = value ?? fallback;
  const [text, setText] = useState(shown);
  const [mode, setMode] = useState<"hex" | "rgb" | "hsl">("hex");
  useEffect(() => {
    if (mode === "hex") setText(shown);
    else if (mode === "rgb") setText(`rgb(${hexToRgb(shown).join(", ")})`);
    else { const [h, s, l] = hexToHsl(shown); setText(`hsl(${h}, ${s}%, ${l}%)`); }
  }, [shown, mode]);
  const commit = () => { const c = parseColor(text); if (c) onChange(c); else setText(shown); };
  return (
    <div>
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-[11px] text-mute">{label}</span>
      <input type="color" value={parseColor(shown) ?? "#ffffff"} onChange={(e) => onChange(e.target.value)} className="h-7 w-8 shrink-0 cursor-pointer rounded border border-line bg-transparent" aria-label={label} />
      <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} className="h-7 min-w-0 font-mono text-[11px]" />
      <button onClick={() => setMode(mode === "hex" ? "rgb" : mode === "rgb" ? "hsl" : "hex")} className="h-7 w-9 shrink-0 rounded border border-line text-[9.5px] font-semibold uppercase text-mute hover:text-fg" title={L("Format", "Format")}>{mode}</button>
      <button onClick={onReset} disabled={!value} className="shrink-0 rounded p-1 text-dim hover:text-fg disabled:opacity-30" title={L("Couleur d'origine", "Original colour")}><RotateCcw className="h-3 w-3" /></button>
    </div>
    <div className="ml-[70px] mt-1 flex gap-1">
      {SWATCHES.map((c) => (
        <button key={c} onClick={() => onChange(c)} title={c} aria-label={c}
          className={cx("h-4 w-4 rounded-full border transition-transform hover:scale-110", shown.toLowerCase() === c ? "border-sky ring-1 ring-sky/60" : "border-white/15")}
          style={{ background: c, boxShadow: `0 0 6px ${c}66` }} />
      ))}
    </div>
    </div>
  );
}

/** Quick palette matching the Companion's glow style. */
const SWATCHES = ["#f4f2ff", "#6f9bff", "#b79cff", "#ff9ad0", "#ffc2dc", "#7de3c8", "#3fc4c0", "#241a66", "#1c1f2e"];

function Num({ label, value, min, max, step, onChange, onCommit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; onCommit: () => void }) {
  return (
    <label className="grid grid-cols-[64px_1fr_56px] items-center gap-2 text-[11px] text-mute">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
      <input type="number" step={step} value={Number(value.toFixed(2))} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} onBlur={onCommit}
        className="h-6 w-full rounded border border-line bg-black/25 px-1 text-right font-mono text-[11px] text-fg" />
    </label>
  );
}

export function Inspector({ layer, asset, onLive, onCommit, onDuplicate, onRemove, onCopy, onZ }: {
  layer: Layer;
  asset: AssetDef | undefined;
  onLive: (patch: Partial<Layer>) => void;
  onCommit: (patch?: Partial<Layer>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onCopy: () => void;
  onZ: (dir: 1 | -1) => void;
}) {
  const L = useL();
  const c = resolveColors(layer, asset);
  const names: Record<ColorKey, string> = { primary: L("Principale", "Primary"), secondary: L("Secondaire", "Secondary"), accent: L("Accent", "Accent"), glow: L("Lueur", "Glow") };
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{asset?.name ?? L("Asset introuvable", "Missing asset")}</div>
          <div className="truncate font-mono text-[10px] text-dim">{layer.slot} · {layer.assetId}</div>
          {!asset && <div className="mt-1 text-[10.5px] text-bad">{L("Ce composant n'existe plus dans la bibliothèque. Il est conservé dans le combo, mais n'est pas affiché.", "This component is no longer in the library. It is kept in the combo but not shown.")}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={layer.flipX ? "primary" : "subtle"} icon={<FlipHorizontal2 className="h-3.5 w-3.5" />} onClick={() => onCommit({ flipX: !layer.flipX })} title={L("Miroir horizontal", "Flip horizontal")} />
        <Button size="sm" variant={layer.flipY ? "primary" : "subtle"} icon={<FlipVertical2 className="h-3.5 w-3.5" />} onClick={() => onCommit({ flipY: !layer.flipY })} title={L("Miroir vertical", "Flip vertical")} />
        <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} disabled={asset ? !asset.duplicable : false} onClick={onDuplicate}>{L("Dupliquer", "Duplicate")}</Button>
        <Button size="sm" onClick={onCopy}>{L("Copier", "Copy")}</Button>
        <Button size="sm" icon={layer.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} onClick={() => onCommit({ hidden: !layer.hidden })} title={L("Masquer", "Hide")} />
        <Button size="sm" icon={layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />} onClick={() => onCommit({ locked: !layer.locked })} title={L("Verrouiller le déplacement", "Lock movement")} />
        <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove}>{L("Retirer", "Remove")}</Button>
      </div>
      <div className="space-y-1.5">
        <Num label="X" value={layer.x} min={-150} max={150} step={1} onChange={(v) => onLive({ x: v })} onCommit={() => onCommit()} />
        <Num label="Y" value={layer.y} min={-150} max={150} step={1} onChange={(v) => onLive({ y: v })} onCommit={() => onCommit()} />
        <Num label={L("Échelle", "Scale")} value={layer.scale} min={0.1} max={4} step={0.01} onChange={(v) => onLive({ scale: Math.max(0.05, v) })} onCommit={() => onCommit()} />
        <Num label={L("Rotation", "Rotation")} value={layer.rotation} min={-180} max={180} step={1} onChange={(v) => onLive({ rotation: v })} onCommit={() => onCommit()} />
        <Num label={L("Opacité", "Opacity")} value={layer.opacity} min={0} max={1} step={0.01} onChange={(v) => onLive({ opacity: v })} onCommit={() => onCommit()} />
        <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-[11px] text-mute">
          {L("Calque (z)", "Layer (z)")}
          <div className="flex items-center gap-1">
            <input type="number" value={layer.z} onChange={(e) => onLive({ z: Number(e.target.value) || 0 })} onBlur={() => onCommit()} className="h-6 w-16 rounded border border-line bg-black/25 px-1 text-right font-mono text-[11px] text-fg" />
            <Button size="sm" variant="ghost" icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => onZ(1)} title={L("Devant", "Forward")} />
            <Button size="sm" variant="ghost" icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => onZ(-1)} title={L("Derrière", "Backward")} />
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onCommit({ x: 0, y: 0, scale: asset?.scale ?? 1, rotation: 0, opacity: 1, flipX: false, flipY: false })} title={L("Réinitialiser la position", "Reset transform")} />
          </div>
        </div>
      </div>
      {asset?.tintable && (
        <div className="space-y-1.5 border-t border-line pt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">{L("Couleurs", "Colours")}</div>
          {COLOR_KEYS.map((k) => (
            <ColorField key={k} label={names[k]} value={layer.colors[k]} fallback={c[k]}
              onChange={(hex) => onCommit({ colors: { ...layer.colors, [k]: hex } })}
              onReset={() => { const n = { ...layer.colors }; delete n[k]; onCommit({ colors: n }); }} />
          ))}
          {asset.assetType !== "svg" && <div className="text-[10px] text-dim">{L("Image : seule la couleur principale recolore l'image.", "Image: only the primary colour recolours it.")}</div>}
        </div>
      )}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]; onClose: () => void }) {
  useEffect(() => {
    const h = () => onClose();
    window.addEventListener("click", h);
    window.addEventListener("blur", h);
    return () => { window.removeEventListener("click", h); window.removeEventListener("blur", h); };
  }, [onClose]);
  return (
    <div className="glass fixed z-50 min-w-44 bg-ink-2/95 py-1 shadow-2xl" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - items.length * 32 - 10) }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <button key={i} disabled={it.disabled} onClick={() => { it.onClick(); onClose(); }}
          className={cx("block w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] disabled:opacity-35", it.danger ? "text-bad" : "text-fg/90")}>{it.label}</button>
      ))}
      <button onClick={onClose} className="absolute right-1 top-1 hidden"><X /></button>
    </div>
  );
}
