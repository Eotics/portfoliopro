// Simple Companion Studio: the creature's shape is fixed; only its colour,
// body style and outfit can be changed.
import { Check, Dice5, Lock, Redo2, Save, Trash2, Undo2, Unlock, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Button, cx } from "../components/ui";
import { loadRegistry, type Registry } from "../lib/assets";
import { STATES, normalizeLook, type CompanionState, type Look } from "../lib/look";
import {
  COLOR_PRESETS, OUTFIT_GROUPS, RANDOM_KEYS, SKINS, applyColor, clearGroup, currentColor, customPreset, outfitAssets, randomizeSimple, setSkin, simpleDefault, simplify, toggleOutfit,
} from "../lib/simpleLook";
import { STARTER_LOOKS, applyStarter } from "../lib/starterLooks";
import { useL, useNexus } from "../lib/store";
import { studio, type ComboData } from "../lib/studioApi";
import { CombosDialog, ImportDialog } from "./dialogs";
import { AssetThumb } from "./panels";

const OUTFIT_SWATCHES = ["#ffd54a", "#ff5577", "#ff9ad0", "#b79cff", "#6f9bff", "#7de3c8", "#ffffff", "#1c1f2e"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5">
      <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{title}</div>
      {children}
    </section>
  );
}

export function SimpleStudio({ reg, onExpert }: { reg: Registry; onExpert: () => void }) {
  const { toast, lang, run } = useNexus();
  const L = useL();
  const slots = reg.slots;
  const [look, setLook] = useState<Look | null>(null);
  const past = useRef<Look[]>([]);
  const future = useRef<Look[]>([]);
  const [, bump] = useState(0);
  const [group, setGroup] = useState(OUTFIT_GROUPS[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<CompanionState>("IDLE");
  const [combos, setCombos] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [showLocks, setShowLocks] = useState(false);
  const [importing, setImporting] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    studio.getLook()
      .then((l) => setLook(simplify(normalizeLook(l ?? undefined), reg.byId, slots)))
      .catch(() => setLook(simpleDefault(reg.byId, slots)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change is applied to the real Companion (debounced).
  const commit = useCallback((next: Look) => {
    setLook((prev) => {
      if (prev) { past.current.push(prev); if (past.current.length > 100) past.current.shift(); future.current = []; }
      return next;
    });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { studio.setLook(next).catch((e) => toast(String(e), "error")); }, 150);
    bump((x) => x + 1);
  }, [toast]);
  const restore = (l: Look) => { setLook(l); studio.setLook(l).catch((e) => toast(String(e), "error")); bump((x) => x + 1); };
  const undo = () => { const p = past.current.pop(); if (p && look) { future.current.push(look); restore(p); } };
  const redo = () => { const f = future.current.pop(); if (f && look) { past.current.push(look); restore(f); } };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.ctrlKey && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const starters = useMemo(() => STARTER_LOOKS.map((s) => ({ s, look: simplify(applyStarter(simpleDefault(reg.byId, slots), s, reg.byId, slots).look, reg.byId, slots) })), [reg, slots]);
  const skins = useMemo(() => SKINS.filter((s) => reg.byId.has(s.id)).map((s) => ({ ...s, preview: setSkin(simpleDefault(reg.byId, slots), s.id, reg.byId, slots) })), [reg, slots]);
  const items = useMemo(() => outfitAssets(reg.assets, group), [reg, group]);

  if (!look) return <div className="p-6 text-[13px] text-mute">…</div>;
  const color = currentColor(look)?.toLowerCase();
  const bodyId = look.layers.find((l) => l.slot === "body")?.assetId;
  const equipped = new Set(look.layers.map((l) => l.assetId));
  const sel = look.layers.find((l) => l.uid === selected && !["body", "arms", "eyes", "mouth", "status"].includes(l.slot));
  const recolor = (hex: string) => sel && commit({ ...look, layers: look.layers.map((l) => (l.uid === sel.uid ? { ...l, colors: { ...l.colors, primary: hex } } : l)) });
  const loadCombo = (d: ComboData, c: { id: string; name: string }) => {
    commit(simplify(normalizeLook({ ...look, layers: d.layers, expressionMap: d.expressionMap ?? look.expressionMap, animationMap: d.animationMap ?? look.animationMap }), reg.byId, slots));
    setLoaded(c.name ? c : null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-2.5">
        <div className="font-display text-[15px] font-semibold tracking-[0.12em]">NEXUS COMPANION STUDIO</div>
        {loaded && <span className="rounded-md border border-sky/30 bg-sky/10 px-2 py-0.5 text-[11px] text-sky">{loaded.name}</span>}
        <span className="ml-auto text-[11px] text-dim">{L("Les changements s'appliquent tout de suite à ton compagnon.", "Changes apply to your Companion right away.")}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* main preview */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_50%_45%,rgb(111_155_255/0.12),transparent_60%)] p-6">
          <Avatar look={look} assets={reg.byId} slots={slots} state={previewState} size={320} />
          <div className="flex max-w-[560px] flex-wrap justify-center gap-1">
            {STATES.map((s) => (
              <button key={s} onClick={() => setPreviewState(s)} className={cx("rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]", previewState === s ? "border-sky/50 bg-sky/10 text-sky" : "border-line text-dim hover:text-fg")}>{s}</button>
            ))}
          </div>
        </div>

        {/* choices */}
        <div className="w-[430px] shrink-0 overflow-y-auto border-x border-line">
          <Section title={L("Couleur", "Colour")}>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_PRESETS.map((p) => (
                <button key={p.id} onClick={() => commit(applyColor(look, p))} title={p.id} aria-label={p.id}
                  className={cx("grid h-8 w-8 place-items-center rounded-full border-2 transition-transform hover:scale-110", color === p.body.primary ? "border-sky" : "border-white/10")}
                  style={{ background: p.swatch, boxShadow: `0 0 10px ${p.swatch}88` }}>
                  {color === p.body.primary && <Check className={cx("h-3.5 w-3.5", p.face ? "text-white" : "text-[#1b1f2a]")} />}
                </button>
              ))}
              <label className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-dashed border-white/25 text-[13px] text-mute hover:text-fg" title={L("Autre couleur", "Other colour")}>
                +
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => commit(applyColor(look, customPreset(e.target.value)))} />
              </label>
            </div>
          </Section>

          <Section title={L("Style", "Style")}>
            <div className="grid grid-cols-4 gap-1.5">
              {skins.map((s) => {
                const preview = s.preview;
                return (
                  <button key={s.id} onClick={() => commit(setSkin(look, s.id, reg.byId, slots))}
                    className={cx("flex flex-col items-center rounded-xl border p-1", bodyId === s.id ? "border-sky/60 bg-sky/[0.07]" : "border-line hover:border-line-2")}>
                    <Avatar look={preview} assets={reg.byId} slots={slots} size={76} motion="off" />
                    <span className="text-[10.5px] text-fg/85">{lang === "en" ? s.en : s.fr}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title={L("Tenue", "Outfit")}>
            <div className="mb-2 flex flex-wrap gap-1">
              {OUTFIT_GROUPS.map((g) => (
                <button key={g.id} onClick={() => setGroup(g.id)} className={cx("rounded-lg px-2.5 py-1 text-[11.5px]", group === g.id ? "bg-white/[0.08] text-fg" : "text-mute hover:text-fg")}>{lang === "en" ? g.en : g.fr}</button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {group === "mine" && (
                <button onClick={() => setImporting(true)} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-sky/40 text-[10.5px] text-sky hover:bg-sky/5">
                  <Upload className="h-4 w-4" />{L("Importer", "Import")}
                </button>
              )}
              <button onClick={() => commit(clearGroup(look, group, reg.byId))} className="grid aspect-square place-items-center rounded-xl border border-dashed border-line text-[11px] text-dim hover:text-fg">{L("Aucun", "None")}</button>
              {items.map((a) => {
                const on = equipped.has(a.id);
                return (
                  <button key={a.id} title={a.name}
                    onClick={() => { const next = toggleOutfit(look, a, slots); commit(next); setSelected(on ? null : next.layers.find((l) => l.assetId === a.id)?.uid ?? null); }}
                    className={cx("relative flex flex-col items-center rounded-xl border p-1", on ? "border-sky/60 bg-sky/[0.08]" : "border-line hover:border-line-2")}>
                    <AssetThumb asset={a} size={60} />
                    <span className="w-full truncate text-center text-[9.5px] text-fg/80">{a.name}</span>
                    {on && <Check className="absolute right-1 top-1 h-3 w-3 text-sky" />}
                    {a.custom && (
                      <span role="button" tabIndex={0} title={L("Supprimer (va dans la Corbeille)", "Delete (goes to the Recycle Bin)")}
                        onClick={(e) => { e.stopPropagation(); if (window.confirm(L(`Supprimer « ${a.name} » ? (Corbeille)`, `Delete "${a.name}"? (Recycle Bin)`))) { if (on) commit(toggleOutfit(look, a, slots)); void run(studio.deleteAsset(a.id), L("Asset supprimé", "Asset deleted")); } }}
                        className="absolute left-1 top-1 rounded p-0.5 text-dim hover:text-bad"><Trash2 className="h-3 w-3" /></span>
                    )}
                  </button>
                );
              })}
            </div>
            {sel && (
              <div className="mt-3 rounded-xl border border-line bg-white/[0.02] p-2.5">
                <div className="mb-1.5 text-[11px] text-mute">{L("Couleur de", "Colour of")} <span className="text-fg">{reg.byId.get(sel.assetId)?.name}</span></div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {OUTFIT_SWATCHES.map((c) => (
                    <button key={c} onClick={() => recolor(c)} aria-label={c} className={cx("h-6 w-6 rounded-full border-2", sel.colors.primary === c ? "border-sky" : "border-white/10")} style={{ background: c }} />
                  ))}
                  <label className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-dashed border-white/25 text-[11px] text-mute">+
                    <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => recolor(e.target.value)} />
                  </label>
                  <button onClick={() => commit({ ...look, layers: look.layers.map((l) => (l.uid === sel.uid ? { ...l, colors: {} } : l)) })} className="ml-1 text-[10.5px] text-dim hover:text-fg">{L("Couleur d'origine", "Original")}</button>
                </div>
              </div>
            )}
          </Section>

          <Section title={L("Aléatoire", "Randomize")}>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={<Dice5 className="h-3.5 w-3.5" />} onClick={() => { commit(randomizeSimple(look, locks, reg.assets, reg.byId, slots)); setSelected(null); }}>{L("Tout mélanger", "Shuffle")}</Button>
              <button onClick={() => setShowLocks((x) => !x)} className="flex items-center gap-1 text-[11px] text-mute hover:text-fg">
                {locks.size ? <Lock className="h-3 w-3 text-warn" /> : <Unlock className="h-3 w-3" />}{L(`Verrous${locks.size ? ` (${locks.size})` : ""}`, `Locks${locks.size ? ` (${locks.size})` : ""}`)}
              </button>
            </div>
            {showLocks && (
              <div className="mt-2 grid grid-cols-2 gap-1">
                {RANDOM_KEYS.map((k) => {
                  const g = OUTFIT_GROUPS.find((x) => x.id === k);
                  const label = k === "color" ? L("Couleur", "Colour") : k === "style" ? L("Style", "Style") : lang === "en" ? g?.en : g?.fr;
                  const on = locks.has(k);
                  return (
                    <button key={k} onClick={() => setLocks((x) => { const c = new Set(x); if (c.has(k)) c.delete(k); else c.add(k); return c; })}
                      className={cx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11.5px]", on ? "border-warn/40 bg-warn/10 text-warn" : "border-line text-mute")}>
                      {on ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}{label}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title={L("Looks prêts", "Ready-made looks")}>
            <div className="grid grid-cols-4 gap-1.5">
              {starters.map(({ s, look: preview }) => (
                <button key={s.id} onClick={() => { commit(preview); setSelected(null); setLoaded(null); }}
                  className="flex flex-col items-center rounded-xl border border-line p-1 hover:border-sky/50">
                  <Avatar look={preview} assets={reg.byId} slots={slots} size={76} motion="off" />
                  <span className="text-[10.5px] text-fg/85">{lang === "en" ? s.en : s.fr}</span>
                </button>
              ))}
            </div>
          </Section>
        </div>

        {/* real-size preview, on a desktop */}
        <div className="flex w-[300px] shrink-0 flex-col gap-2 p-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Sur ton bureau", "On your desktop")}</div>
          <div className="relative h-[330px] overflow-hidden rounded-xl border border-line bg-[radial-gradient(120%_90%_at_20%_0%,#2b2a5e_0%,#121433_45%,#07080f_100%)]">
            <div className="absolute inset-x-0 bottom-0 h-7 border-t border-white/10 bg-black/40 backdrop-blur" />
            <div className="absolute bottom-9 right-2">
              <Avatar look={look} assets={reg.byId} slots={slots} state={previewState} size={170} />
            </div>
          </div>
          <div className="text-[10.5px] leading-relaxed text-dim">{L("Taille réelle du compagnon flottant. Choisis un état sous l'aperçu pour voir ses expressions et ses mouvements.", "Actual size of the floating Companion. Pick a state under the preview to see its expressions and movements.")}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-line bg-black/25 px-4 py-2.5">
        <Button size="sm" icon={<Undo2 className="h-3.5 w-3.5" />} disabled={!past.current.length} onClick={undo}>{L("Annuler", "Undo")}</Button>
        <Button size="sm" icon={<Redo2 className="h-3.5 w-3.5" />} disabled={!future.current.length} onClick={redo}>{L("Rétablir", "Redo")}</Button>
        <Button size="sm" variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => { commit(simpleDefault(reg.byId, slots)); setSelected(null); setLoaded(null); }}>{L("Réinitialiser", "Reset")}</Button>
        <span className="flex-1" />
        <button onClick={onExpert} className="mr-2 text-[10.5px] text-dim hover:text-mute">{L("Mode expert", "Expert mode")}</button>
        <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} onClick={() => setCombos(true)}>{L("Mes looks (enregistrer / charger)", "My looks (save / load)")}</Button>
      </div>
      <ImportDialog open={importing} onClose={() => setImporting(false)} reg={reg} defaultCategory="custom"
        onImported={() => { setGroup("mine"); void loadRegistry(true); }} />
      <CombosDialog open={combos} onClose={() => setCombos(false)} reg={reg} look={look} loaded={loaded} onLoad={loadCombo} onSaved={setLoaded} />
    </div>
  );
}
