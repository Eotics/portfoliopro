import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ClipboardPaste, Dice5, FolderOpen, Layers, Lock, PencilRuler, RefreshCw, Redo2, Save, Search, Shapes, Sparkles, Undo2, Unlock, Upload, UserRound, Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, layerBox } from "../components/Avatar";
import { Button, Empty, Input, Select, cx } from "../components/ui";
import { clearAssetCache, isOpaqueAt, loadRegistry, useRegistry, type Registry } from "../lib/assets";
import { PRESETS, STATES, defaultLook, equip, newUid, normalizeLook, randomize, type AssetDef, type CompanionState, type Layer, type Look, type RandomMode } from "../lib/look";
import { useL, useNexus } from "../lib/store";
import { STARTER_LOOKS, applyStarter } from "../lib/starterLooks";
import { studio, type ComboData } from "../lib/studioApi";
import { CombosDialog, EditAssetDialog, ImportDialog, MappingDialog, ProfilesDialog, ShapeEditor, slotOptions } from "./dialogs";
import { AssetCard, ContextMenu, Inspector } from "./panels";
import { SimpleStudio } from "./SimpleStudio";

const HISTORY_LIMIT = 300; // memory bound for undo; older steps are dropped, never the look itself
const PAGE = 120;
type Special = "__looks" | "__all" | "__mine" | "__recent" | "__favorites" | "__used";

export default function StudioPage() {
  const reg = useRegistry();
  const [expert, setExpert] = useState(false);
  if (!reg) return <div className="p-6 text-[13px] text-mute">Chargement des assets…</div>;
  // Default: simple studio (colour + outfit, fixed shape). Expert = free layer editing.
  return expert ? <StudioInner reg={reg} onSimple={() => setExpert(false)} /> : <SimpleStudio reg={reg} onExpert={() => setExpert(true)} />;
}

function StudioInner({ reg, onSimple }: { reg: Registry; onSimple: () => void }) {
  const { run, toast, lang } = useNexus();
  const L = useL();
  const [look, setLook] = useState<Look | null>(null);
  const past = useRef<Look[]>([]);
  const future = useRef<Look[]>([]);
  const [, bump] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("body");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [previewState, setPreviewState] = useState<CompanionState>("IDLE");
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<Layer | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; asset: AssetDef } | null>(null);
  const [dialog, setDialog] = useState<null | "import" | "shape" | "mapping" | "combos" | "profiles" | "locks">(null);
  const [editAsset, setEditAsset] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  const [live, setLive] = useState(true);
  const pushTimer = useRef<number | undefined>(undefined);

  useEffect(() => { studio.getLook().then((l) => setLook(l ? normalizeLook(l) : defaultLook())).catch(() => setLook(defaultLook())); }, []);

  // Apply to the real Companion (debounced) — the preview itself never waits.
  const pushLive = useCallback((l: Look) => {
    if (!live) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => { studio.setLook(l).catch((e) => toast(String(e), "error")); }, 200);
  }, [live, toast]);

  const commit = useCallback((next: Look, record = true) => {
    setLook((prev) => {
      if (record && prev) {
        past.current.push(prev);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
        future.current = [];
      }
      return next;
    });
    pushLive(next);
    bump((x) => x + 1);
  }, [pushLive]);

  const undo = () => { const p = past.current.pop(); if (p && look) { future.current.push(look); setLook(p); pushLive(p); bump((x) => x + 1); } };
  const redo = () => { const f = future.current.pop(); if (f && look) { past.current.push(look); setLook(f); pushLive(f); bump((x) => x + 1); } };

  const slots = useMemo(() => {
    const out = [...reg.slots];
    for (const [id, name] of slotOptions(reg)) if (!out.some((s) => s.id === id)) out.push({ id, name, multiple: true, zDefault: 50 });
    return out;
  }, [reg]);

  // Thumbnails of the starter looks (built once per registry, not on every drag).
  const starters = useMemo(() => STARTER_LOOKS.map((s) => ({ s, look: applyStarter(defaultLook(), s, reg.byId, slots).look })), [reg, slots]);

  const assets = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = reg.assets;
    switch (category as Special | string) {
      case "__looks": return [];
      case "__all": break;
      case "__mine": list = list.filter((a) => a.custom); break;
      case "__favorites": list = list.filter((a) => a.favorite); break;
      case "__recent": list = [...list].filter((a) => a.added).sort((a, b) => (b.added ?? "").localeCompare(a.added ?? "")).slice(0, 60); break;
      case "__used": list = [...list].filter((a) => a.lastUsed).sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "")); break;
      default: list = list.filter((a) => a.category === category);
    }
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)) || a.id.toLowerCase().includes(q));
    return list;
  }, [reg, category, query]);

  useEffect(() => setLimit(PAGE), [category, query]);

  const sel = look?.layers.find((l) => l.uid === selected) ?? null;
  const patchLayer = (uid: string, p: Partial<Layer>, record: boolean) => {
    if (!look) return;
    commit({ ...look, layers: look.layers.map((l) => (l.uid === uid ? { ...l, ...p } : l)) }, record);
  };

  const doEquip = (a: AssetDef) => {
    if (!look || !a.supported) return;
    try {
      const next = equip(look, a, slots);
      commit(next);
      setSelected(next.layers[next.layers.length - 1]!.uid);
      void studio.touch(a.id);
    } catch (e) { toast(String(e instanceof Error ? e.message : e), "error"); }
  };
  const removeLayer = (uid: string) => { if (look) { commit({ ...look, layers: look.layers.filter((l) => l.uid !== uid) }); if (selected === uid) setSelected(null); } };
  const duplicateLayer = (uid: string) => {
    if (!look) return;
    const l = look.layers.find((x) => x.uid === uid);
    if (!l) return;
    const copy = { ...l, uid: newUid(), x: l.x + 10, y: l.y, colors: { ...l.colors } };
    commit({ ...look, layers: [...look.layers, copy] });
    setSelected(copy.uid);
  };
  const paste = () => {
    if (!look || !clipboard) return;
    const copy = { ...clipboard, uid: newUid(), x: clipboard.x + 8, y: clipboard.y + 8, colors: { ...clipboard.colors } };
    commit({ ...look, layers: [...look.layers, copy] });
    setSelected(copy.uid);
  };
  const moveZ = (uid: string, dir: 1 | -1) => {
    if (!look) return;
    const sorted = [...look.layers].sort((a, b) => a.z - b.z);
    const i = sorted.findIndex((l) => l.uid === uid);
    const other = sorted[i + dir];
    const me = sorted[i]!;
    const z = other ? other.z + dir * (other.z === me.z ? 1 : 0.5) : me.z + dir * 5;
    patchLayer(uid, { z: Math.round(z * 2) / 2 }, true);
  };

  // ---------------- preview interaction: click selects the topmost opaque layer, drag moves it
  const stage = useRef<HTMLDivElement>(null);
  const STAGE = 380;
  const drag = useRef<{ uid: string; sx: number; sy: number; ox: number; oy: number; or: number; rotate: boolean } | null>(null);
  const toCanvas = (e: React.PointerEvent | React.WheelEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 200, y: ((e.clientY - r.top) / r.height) * 200 };
  };
  const hitTest = async (p: { x: number; y: number }) => {
    if (!look || !stage.current) return null;
    const nodes = [...stage.current.querySelectorAll<HTMLElement>("[data-uid]")].reverse();
    for (const n of nodes) {
      const l = look.layers.find((x) => x.uid === n.dataset.uid);
      const img = n.querySelector("img");
      if (!l || !img) continue;
      const a = reg.byId.get(l.assetId);
      const b = layerBox(l, a);
      const ox = b.left + b.w * (a?.anchor?.x ?? 0.5), oy = b.top + b.w * (a?.anchor?.y ?? 0.5);
      let dx = p.x - ox, dy = p.y - oy;
      const t = (-l.rotation * Math.PI) / 180;
      [dx, dy] = [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)];
      if (l.flipX) dx = -dx;
      if (l.flipY) dy = -dy;
      const u = (ox + dx - b.left) / b.w, v = (oy + dy - b.top) / b.w;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      if (await isOpaqueAt(img.src, u, v)) return l;
    }
    return null;
  };
  const onDown = async (e: React.PointerEvent) => {
    if (!look) return;
    const p = toCanvas(e);
    const target = (e.target as HTMLElement).setPointerCapture ? e.currentTarget : null;
    (target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    const hit = await hitTest(p);
    const l = hit ?? sel;
    if (hit) setSelected(hit.uid);
    if (l && !l.locked) drag.current = { uid: l.uid, sx: p.x, sy: p.y, ox: l.x, oy: l.y, or: l.rotation, rotate: e.shiftKey };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !look) return;
    const p = toCanvas(e);
    if (d.rotate) {
      const l = look.layers.find((x) => x.uid === d.uid)!;
      const c = { x: 100 + l.x, y: 100 + l.y };
      const a0 = Math.atan2(d.sy - c.y, d.sx - c.x), a1 = Math.atan2(p.y - c.y, p.x - c.x);
      patchLayer(d.uid, { rotation: Math.round(d.or + ((a1 - a0) * 180) / Math.PI) }, false);
    } else {
      patchLayer(d.uid, { x: Math.round(d.ox + p.x - d.sx), y: Math.round(d.oy + p.y - d.sy) }, false);
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !look) return;
    const l = look.layers.find((x) => x.uid === d.uid);
    if (l && (l.x !== d.ox || l.y !== d.oy || l.rotation !== d.or)) {
      // Record one history step for the whole gesture.
      past.current.push({ ...look, layers: look.layers.map((x) => (x.uid === d.uid ? { ...x, x: d.ox, y: d.oy, rotation: d.or } : x)) });
      future.current = [];
      bump((x) => x + 1);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!sel || sel.locked) return;
    const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    patchLayer(sel.uid, { scale: Math.min(6, Math.max(0.05, Math.round(sel.scale * f * 100) / 100)) }, true);
  };

  // ---------------- keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.ctrlKey && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.ctrlKey && k === "c" && sel) { setClipboard(sel); void navigator.clipboard?.writeText(JSON.stringify(sel)); }
      else if (e.ctrlKey && k === "v") paste();
      else if (e.ctrlKey && k === "d" && sel) { e.preventDefault(); duplicateLayer(sel.uid); }
      else if ((k === "delete" || k === "backspace") && sel) removeLayer(sel.uid);
      else if (sel && !sel.locked && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        patchLayer(sel.uid, { x: sel.x + (k === "arrowleft" ? -step : k === "arrowright" ? step : 0), y: sel.y + (k === "arrowup" ? -step : k === "arrowdown" ? step : 0) }, true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!look) return <div className="p-6 text-[13px] text-mute">…</div>;
  const equippedIds = new Set(look.layers.map((l) => l.assetId));
  const sortedEquipped = [...look.layers].sort((a, b) => b.z - a.z);
  const loadCombo = (d: ComboData, c: { id: string; name: string }) => {
    commit(normalizeLook({ ...look, layers: d.layers, expressionMap: d.expressionMap ?? look.expressionMap, animationMap: d.animationMap ?? look.animationMap }));
    setLoaded(c.name ? c : null);
    setSelected(null);
  };
  const doRandom = (mode: RandomMode) => commit(randomize(look, mode, reg.assets, slots, locks));
  const missing = look.layers.filter((l) => !reg.byId.has(l.assetId)).length;
  const counts = (id: string) => reg.assets.filter((a) => a.category === id).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5">
        <div className="font-display text-[15px] font-semibold tracking-[0.12em]">NEXUS COMPANION STUDIO</div>
        {loaded && <span className="rounded-md border border-sky/30 bg-sky/10 px-2 py-0.5 text-[11px] text-sky">{L("Combo", "Combo")} : {loaded.name}</span>}
        <button onClick={onSimple} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-mute hover:text-fg">{L("← Mode simple", "← Simple mode")}</button>
        <div className="ml-auto flex items-center gap-2 text-[11.5px] text-mute">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />{L("Appliquer en direct au Companion", "Apply live to the Companion")}</label>
          <Select className="h-7 text-[11px]" value={look.size ?? "m"} onChange={(e) => commit({ ...look, size: e.target.value as "s" | "m" | "l" })} aria-label={L("Taille", "Size")}>
            <option value="s">{L("Petit", "Small")}</option><option value="m">{L("Moyen", "Medium")}</option><option value="l">{L("Grand", "Large")}</option>
          </Select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* categories (dynamic slots) */}
        <nav className="w-44 shrink-0 overflow-y-auto border-r border-line p-2 text-[12.5px]">
          {([["__looks", L("Looks prêts", "Starter looks")], ["__all", L("Tout", "All")], ["__mine", L("Mes assets", "My assets")], ["__recent", L("Ajoutés récemment", "Recently added")], ["__favorites", L("Favoris", "Favorites")], ["__used", L("Utilisés récemment", "Recently used")]] as const).map(([id, n]) => (
            <button key={id} onClick={() => setCategory(id)} className={cx("block w-full rounded-lg px-2.5 py-1.5 text-left", category === id ? "bg-white/[0.07] text-fg" : "text-mute hover:text-fg")}>{n}</button>
          ))}
          <div className="my-2 h-px bg-line" />
          {slots.map((s) => (
            <button key={s.id} onClick={() => setCategory(s.id)} className={cx("flex w-full items-center rounded-lg px-2.5 py-1.5 text-left", category === s.id ? "bg-white/[0.07] text-fg" : "text-mute hover:text-fg")}>
              <span className="flex-1 truncate">{s.name}</span>
              {locks.has(s.id) && <Lock className="mr-1 h-3 w-3 text-warn" />}
              <span className="text-[10px] text-dim">{counts(s.id)}</span>
            </button>
          ))}
          <div className="my-2 h-px bg-line" />
          <button onClick={() => setDialog("mapping")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-mute hover:text-fg"><Sparkles className="h-3.5 w-3.5" />{L("Expressions & animations", "Expressions & animations")}</button>
          <button onClick={() => setDialog("shape")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-mute hover:text-fg"><PencilRuler className="h-3.5 w-3.5" />{L("Créer un composant", "Create a component")}</button>
          <button onClick={() => setDialog("profiles")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-mute hover:text-fg"><UserRound className="h-3.5 w-3.5" />{L("Profils", "Profiles")}</button>
          <button onClick={() => studio.openFolder()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-mute hover:text-fg"><FolderOpen className="h-3.5 w-3.5" />{L("Dossier des packs", "Packs folder")}</button>
          <button onClick={() => { clearAssetCache(); void loadRegistry(true); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-mute hover:text-fg"><RefreshCw className="h-3.5 w-3.5" />{L("Rescanner les packs", "Rescan packs")}</button>
          <div className="mt-2 px-2.5 text-[10px] leading-relaxed text-dim">{reg.assets.length} assets · {reg.packs.length} packs · {slots.length} {L("emplacements", "slots")}</div>
        </nav>

        {/* library */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
          <div className="flex items-center gap-1.5 p-2">
            <div className="relative flex-1"><Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-dim" /><Input className="h-8 pl-7 text-[12px]" placeholder={L("Rechercher…", "Search…")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setDialog("import")} title={L("Importer un asset", "Import asset")} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
            {category === "__looks" ? (
              <div className="grid grid-cols-2 gap-1.5">
                {starters.map(({ s, look: preview }) => {
                  return (
                    <button key={s.id} onClick={() => { const r = applyStarter(look, s, reg.byId, slots); commit(r.look); setLoaded(null); setSelected(null); if (r.missing.length) toast(L(`Assets introuvables : ${r.missing.join(", ")}`, `Missing assets: ${r.missing.join(", ")}`), "error"); }}
                      className="flex flex-col items-center rounded-xl border border-line bg-[radial-gradient(circle_at_50%_45%,rgb(111_155_255/0.10),transparent_70%)] p-1.5 hover:border-sky/50">
                      <Avatar look={preview} assets={reg.byId} slots={slots} size={110} motion="off" />
                      <span className="mt-0.5 text-[11px] text-fg/85">{lang === "en" ? s.en : s.fr}</span>
                    </button>
                  );
                })}
              </div>
            ) : assets.length === 0 ? <Empty icon={<Shapes className="h-6 w-6" />} title={L("Aucun asset ici", "No assets here")}>{L("Importez une image ou créez un composant.", "Import an image or create a component.")}</Empty> : (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {assets.slice(0, limit).map((a) => (
                    <AssetCard key={a.id} asset={a} equipped={equippedIds.has(a.id)} onEquip={() => doEquip(a)}
                      onFavorite={() => run(studio.favorite(a.id, !a.favorite))}
                      onMenu={(e) => { e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, asset: a }); }} />
                  ))}
                </div>
                {assets.length > limit && <Button size="sm" className="mt-2 w-full" onClick={() => setLimit(limit + PAGE)}>{L(`Afficher plus (${assets.length - limit})`, `Show more (${assets.length - limit})`)}</Button>}
              </>
            )}
          </div>
        </div>

        {/* live preview */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_45%,rgb(139_125_255/0.08),transparent_60%)] p-4">
          <div ref={stage} className="relative touch-none rounded-2xl border border-line bg-[repeating-conic-gradient(rgb(255_255_255/0.025)_0_25%,transparent_0_50%)] [background-size:24px_24px]"
            style={{ width: STAGE, height: STAGE }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
            <Avatar look={look} assets={reg.byId} slots={slots} state={previewState} size={STAGE} selected={selected} />
          </div>
          <div className="text-[10.5px] text-dim">{L("Cliquez un élément pour le sélectionner · glisser = déplacer · Maj+glisser = tourner · molette = taille · flèches = ajuster", "Click a part to select · drag = move · Shift+drag = rotate · wheel = size · arrows = nudge")}</div>
          <div className="flex flex-wrap justify-center gap-1">
            <span className="mr-1 self-center text-[10.5px] text-mute">{L("Aperçu de l'état :", "Preview state:")}</span>
            {STATES.map((s) => (
              <button key={s} onClick={() => setPreviewState(s)} className={cx("rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]", previewState === s ? "border-sky/50 bg-sky/10 text-sky" : "border-line text-dim hover:text-fg")}>{s}</button>
            ))}
          </div>
          {missing > 0 && <div className="text-[11px] text-warn">{missing} {L("composant(s) introuvable(s) dans la bibliothèque (conservé(s), non affiché(s))", "component(s) missing from the library (kept, not shown)")}</div>}
        </div>

        {/* equipped + inspector */}
        <div className="flex w-[330px] shrink-0 flex-col border-l border-line">
          <div className="flex items-center gap-2 px-3 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute"><Layers className="h-3.5 w-3.5" />{L("Équipé", "Equipped")} ({look.layers.length})</div>
          <ul className="max-h-[38%] overflow-y-auto p-2">
            {sortedEquipped.map((l) => {
              const a = reg.byId.get(l.assetId);
              return (
                <li key={l.uid}>
                  <button onClick={() => setSelected(l.uid)} className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px]", selected === l.uid ? "bg-sky/10 text-fg" : "text-fg/85 hover:bg-white/[0.04]", l.hidden && "opacity-50")}>
                    <span className="w-16 shrink-0 truncate font-mono text-[9.5px] text-dim">{l.slot}</span>
                    <span className={cx("min-w-0 flex-1 truncate", !a && "text-bad")}>{a?.name ?? l.assetId}</span>
                    {l.flipX && <span className="text-[9px] text-dim">⇋</span>}
                    {l.locked && <Lock className="h-3 w-3 text-dim" />}
                    <span className="font-mono text-[9.5px] text-dim">{l.z}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-3">
            {sel ? (
              <Inspector layer={sel} asset={reg.byId.get(sel.assetId)}
                onLive={(p) => patchLayer(sel.uid, p, false)}
                onCommit={(p) => { if (p) patchLayer(sel.uid, p, true); else { past.current.push(look); future.current = []; bump((x) => x + 1); } }}
                onDuplicate={() => duplicateLayer(sel.uid)} onRemove={() => removeLayer(sel.uid)}
                onCopy={() => { setClipboard(sel); toast(L("Composant copié", "Component copied"), "info"); }} onZ={(d) => moveZ(sel.uid, d)} />
            ) : <div className="text-[12px] text-dim">{L("Sélectionnez un composant pour le déplacer, le redimensionner, le tourner, le retourner ou changer ses couleurs.", "Select a component to move, resize, rotate, flip or recolour it.")}</div>}
          </div>
        </div>
      </div>

      {/* action bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-black/25 px-4 py-2.5">
        <Button size="sm" icon={<Undo2 className="h-3.5 w-3.5" />} disabled={!past.current.length} onClick={undo}>{L("Annuler", "Undo")}</Button>
        <Button size="sm" icon={<Redo2 className="h-3.5 w-3.5" />} disabled={!future.current.length} onClick={redo}>{L("Rétablir", "Redo")}</Button>
        <Button size="sm" icon={<ClipboardPaste className="h-3.5 w-3.5" />} disabled={!clipboard} onClick={paste}>{L("Coller", "Paste")}</Button>
        <span className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" icon={<Dice5 className="h-3.5 w-3.5" />} onClick={() => doRandom("everything")}>{L("Tout aléatoire", "Randomize")}</Button>
        <Select className="h-7 text-[11px]" value="" onChange={(e) => { if (e.target.value) doRandom(e.target.value as RandomMode); }} aria-label={L("Aléatoire…", "Random…")}>
          <option value="">{L("Aléatoire : …", "Random: …")}</option>
          <option value="accessories">{L("Accessoires", "Accessories")}</option><option value="colors">{L("Couleurs", "Colours")}</option>
          <option value="effects">{L("Effets", "Effects")}</option><option value="head">{L("Tête", "Head")}</option>
          <option value="body">{L("Corps", "Body")}</option><option value="animation">{L("Animation", "Animation")}</option>
        </Select>
        <Button size="sm" icon={locks.size ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />} onClick={() => setDialog("locks")}>{L("Verrous", "Locks")} {locks.size ? `(${locks.size})` : ""}</Button>
        <Select className="h-7 text-[11px]" value="" onChange={(e) => { const p = PRESETS[e.target.value]; if (p) commit(p.apply(look)); }} aria-label={L("Personnalité", "Personality")}>
          <option value="">{L("Personnalité : …", "Personality: …")}</option>
          {Object.entries(PRESETS).map(([id, p]) => <option key={id} value={id}>{lang === "en" ? p.en : p.fr}</option>)}
        </Select>
        <Button size="sm" variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => { commit(defaultLook()); setLoaded(null); setSelected(null); }}>{L("Réinitialiser", "Reset")}</Button>
        <span className="flex-1" />
        <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setDialog("import")}>{L("Importer un asset", "Import asset")}</Button>
        <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} onClick={() => setDialog("combos")}>{L("Combos (enregistrer / charger / exporter)", "Combos (save / load / export)")}</Button>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: L("Équiper", "Equip"), onClick: () => doEquip(menu.asset), disabled: !menu.asset.supported },
          { label: menu.asset.favorite ? L("Retirer des favoris", "Unfavorite") : L("Ajouter aux favoris", "Favorite"), onClick: () => void run(studio.favorite(menu.asset.id, !menu.asset.favorite)) },
          { label: L("Dupliquer dans Mes assets", "Duplicate into My assets"), onClick: () => void run(studio.duplicateAsset(menu.asset.id), L("Copie créée", "Copy created")) },
          { label: L("Modifier / renommer", "Edit / rename"), onClick: () => setEditAsset(menu.asset.id), disabled: !menu.asset.custom },
          { label: L("Exporter…", "Export…"), onClick: async () => { const d = await openDialog({ directory: true, title: L("Dossier d'export", "Export folder") }); if (typeof d === "string") await run(studio.exportAsset(menu.asset.id, d), L("Asset exporté", "Asset exported")); } },
          { label: L("Supprimer (Corbeille)", "Delete (Recycle Bin)"), onClick: () => void run(studio.deleteAsset(menu.asset.id), L("Asset supprimé", "Asset deleted")), danger: true, disabled: !menu.asset.custom },
        ]} />
      )}

      <ImportDialog open={dialog === "import"} onClose={() => setDialog(null)} reg={reg} defaultCategory={category.startsWith("__") ? undefined : category}
        onImported={(id, eq) => { pendingEquip.current = eq ? id : null; setCategory("__mine"); void loadRegistry(true); }} />
      <ShapeEditor open={dialog === "shape"} onClose={() => setDialog(null)} reg={reg} look={look} onCreated={(id) => { pendingEquip.current = id; void loadRegistry(true); setCategory("__mine"); }} />
      <MappingDialog open={dialog === "mapping"} onClose={() => setDialog(null)} look={look} onChange={(l) => commit(l)} onPreview={setPreviewState} />
      <CombosDialog open={dialog === "combos"} onClose={() => setDialog(null)} reg={reg} look={look} loaded={loaded} onLoad={loadCombo} onSaved={setLoaded} />
      <ProfilesDialog open={dialog === "profiles"} onClose={() => setDialog(null)} reg={reg} look={look} onActivated={(l) => { setLook(l); past.current = []; future.current = []; }} />
      <EditAssetDialog assetId={editAsset} reg={reg} onClose={() => setEditAsset(null)} />
      {dialog === "locks" && (
        <div className="fixed inset-0 z-40" onClick={() => setDialog(null)}>
          <div className="glass absolute bottom-14 left-[420px] w-72 bg-ink-2/95 p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">{L("Verrouiller pour l'aléatoire", "Lock for randomizer")}</div>
            <div className="grid max-h-72 grid-cols-2 gap-1 overflow-y-auto">
              {[...slots.map((s) => [s.id, s.name] as const), ["animation", "Animation"] as const].map(([id, n]) => (
                <button key={id} onClick={() => setLocks((x) => { const c = new Set(x); if (c.has(id)) c.delete(id); else c.add(id); return c; })}
                  className={cx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11.5px]", locks.has(id) ? "border-warn/40 bg-warn/10 text-warn" : "border-line text-mute")}>
                  {locks.has(id) ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}{n}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <PendingEquip pendingRef={pendingEquip} reg={reg} onEquip={doEquip} />
    </div>
  );
}

// Equip an asset as soon as it appears in the registry after an import/creation.
const pendingEquip: { current: string | null } = { current: null };
function PendingEquip({ pendingRef, reg, onEquip }: { pendingRef: { current: string | null }; reg: Registry; onEquip: (a: AssetDef) => void }) {
  useEffect(() => {
    const id = pendingRef.current;
    if (!id) return;
    const a = reg.byId.get(id);
    if (a) { pendingRef.current = null; onEquip(a); }
  }, [reg, pendingRef, onEquip]);
  return null;
}
