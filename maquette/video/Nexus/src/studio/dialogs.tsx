import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, History, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Button, ConfirmButton, Empty, Input, Modal, Select, Toggle, cx, fmtTime } from "../components/ui";
import { svgUrl, type Registry } from "../lib/assets";
import { ANIMATIONS, EXPRESSIONS, STATES, normalizeLook, type CompanionState, type Look } from "../lib/look";
import { useL, useNexus } from "../lib/store";
import { studio, type ComboData, type ComboDetail, type ComboSummary, type Profile } from "../lib/studioApi";

export function slotOptions(reg: Registry) {
  const ids = new Map(reg.slots.map((s) => [s.id, s.name]));
  for (const a of reg.assets) if (!ids.has(a.category)) ids.set(a.category, a.category);
  return [...ids.entries()];
}

// ---------------------------------------------------------------- import

export function ImportDialog({ open, onClose, reg, onImported, defaultCategory }: {
  open: boolean; onClose: () => void; reg: Registry; onImported: (id: string, equip: boolean) => void; defaultCategory?: string;
}) {
  const { run, toast } = useNexus();
  const L = useL();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState(defaultCategory ?? "wings");
  const [newCat, setNewCat] = useState("");
  const [z, setZ] = useState<number | "">("");
  const [tintable, setTintable] = useState(false);
  const [mirrorable, setMirrorable] = useState(true);
  const [duplicable, setDuplicable] = useState(true);
  const [scale, setScale] = useState(1);
  const [ax, setAx] = useState(0.5);
  const [ay, setAy] = useState(0.5);
  const [equipNow, setEquipNow] = useState(true);
  useEffect(() => { if (open && defaultCategory && defaultCategory !== "__all") setCategory(defaultCategory); }, [open, defaultCategory]);
  const opts = slotOptions(reg);
  const cat = category === "__new" ? newCat.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") : category;
  const slotZ = reg.slots.find((s) => s.id === cat)?.zDefault;

  const pick = async () => {
    const r = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "svg", "webp", "gltf", "glb"] }] });
    if (typeof r === "string") {
      setPath(r);
      if (!name) setName(r.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
      setTintable(r.toLowerCase().endsWith(".svg"));
    }
  };
  const submit = async () => {
    if (!cat) { toast(L("Choisissez une catégorie", "Choose a category"), "error"); return; }
    const id = await run(studio.importAsset(path, {
      name, category: cat, zIndex: z === "" ? slotZ ?? 50 : z, tintable, mirrorable, duplicable, scale, anchorX: ax, anchorY: ay,
    }), L("Asset importé dans Mes assets", "Asset imported into My Assets"));
    if (id) { onImported(id, equipNow); setPath(""); setName(""); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title={L("Importer un asset personnalisé", "Import a custom asset")}>
      <div className="space-y-3 text-[12.5px]">
        <div className="flex gap-2">
          <Input readOnly value={path} placeholder={L("Fichier PNG, SVG ou WEBP…", "PNG, SVG or WEBP file…")} />
          <Button icon={<Upload className="h-4 w-4" />} onClick={pick}>{L("Choisir", "Browse")}</Button>
        </div>
        <label className="block">{L("Nom de l'asset", "Asset name")}<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">{L("Catégorie / emplacement", "Category / slot")}
            <Select className="w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
              {opts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              <option value="__new">{L("+ Nouvel emplacement…", "+ New slot…")}</option>
            </Select>
          </label>
          <label className="block">{L("Calque (z)", "Layer (z)")}<Input type="number" placeholder={String(slotZ ?? 50)} value={z} onChange={(e) => setZ(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        </div>
        {category === "__new" && <label className="block">{L("Identifiant du nouvel emplacement", "New slot id")}<Input placeholder="floating_hologram" value={newCat} onChange={(e) => setNewCat(e.target.value)} /></label>}
        <div className="grid grid-cols-3 gap-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5">{L("Teintable", "Tintable")}<Toggle checked={tintable} onChange={setTintable} /></label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5">{L("Miroir", "Mirrored")}<Toggle checked={mirrorable} onChange={setMirrorable} /></label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5">{L("Duplicable", "Duplicable")}<Toggle checked={duplicable} onChange={setDuplicable} /></label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">{L("Échelle par défaut", "Default scale")}<Input type="number" step="0.1" value={scale} onChange={(e) => setScale(Number(e.target.value) || 1)} /></label>
          <label className="block">{L("Ancre X (0–1)", "Anchor X (0–1)")}<Input type="number" step="0.05" value={ax} onChange={(e) => setAx(Number(e.target.value))} /></label>
          <label className="block">{L("Ancre Y (0–1)", "Anchor Y (0–1)")}<Input type="number" step="0.05" value={ay} onChange={(e) => setAy(Number(e.target.value))} /></label>
        </div>
        <label className="flex items-center gap-2"><Toggle checked={equipNow} onChange={setEquipNow} />{L("Équiper tout de suite", "Equip right away")}</label>
        <p className="text-[11px] text-dim">{L("Les SVG sont nettoyés (scripts, liens externes et gestionnaires d'événements supprimés) et les images sont vérifiées. Rien n'est jamais exécuté. GLTF/GLB : non pris en charge par le rendu 2D actuel.",
          "SVGs are sanitised (scripts, external links and event handlers removed) and images are verified. Nothing is ever executed. GLTF/GLB: not supported by the current 2D renderer.")}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{L("Annuler", "Cancel")}</Button><Button variant="primary" disabled={!path || !name.trim()} onClick={submit}>{L("Importer", "Import")}</Button></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- shape editor (user-created components)

type ShapeType = "circle" | "ellipse" | "rect" | "triangle" | "star" | "heart" | "horn" | "wing" | "tail";
interface Shape { id: number; type: ShapeType; x: number; y: number; w: number; h: number; r: number; fill: string; stroke: string; sw: number; opacity: number }
const FILLS = ["primary", "secondary", "accent", "glow"];

function shapeSvg(s: Shape): string {
  const fill = FILLS.includes(s.fill) ? `{{${s.fill}}}` : s.fill;
  const stroke = s.sw > 0 ? ` stroke="${FILLS.includes(s.stroke) ? `{{${s.stroke}}}` : s.stroke}" stroke-width="${s.sw}" stroke-linejoin="round"` : "";
  const t = ` transform="translate(${s.x} ${s.y}) rotate(${s.r}) scale(${s.w / 100} ${s.h / 100})"`;
  const common = ` fill="${fill}" opacity="${s.opacity}"${stroke}`;
  const vs = s.sw > 0 ? ` vector-effect="non-scaling-stroke"` : "";
  switch (s.type) {
    case "circle": return `<circle cx="0" cy="0" r="50"${common}${t}${vs}/>`;
    case "ellipse": return `<ellipse cx="0" cy="0" rx="50" ry="32"${common}${t}${vs}/>`;
    case "rect": return `<rect x="-50" y="-50" width="100" height="100" rx="14"${common}${t}${vs}/>`;
    case "triangle": return `<path d="M0 -50 L50 45 L-50 45 Z"${common}${t}${vs}/>`;
    case "star": return `<path d="M0 -50 L12 -16 L48 -16 L19 6 L30 42 L0 20 L-30 42 L-19 6 L-48 -16 L-12 -16 Z"${common}${t}${vs}/>`;
    case "heart": return `<path d="M0 40 C-60 0 -40 -50 0 -20 C40 -50 60 0 0 40 Z"${common}${t}${vs}/>`;
    case "horn": return `<path d="M-20 50 C-30 10 -10 -30 20 -50 C10 -20 10 20 20 50 Z"${common}${t}${vs}/>`;
    case "wing": return `<path d="M50 0 C20 -40 -30 -50 -50 -30 C-30 -25 -35 -10 -45 0 C-30 0 -30 15 -38 25 C-20 20 -10 30 0 38 C10 20 30 15 50 0 Z"${common}${t}${vs}/>`;
    case "tail": return `<path d="M-50 40 C-10 50 20 30 10 0 C0 -30 30 -50 50 -40" fill="none" stroke="${fill}" stroke-width="10" stroke-linecap="round" opacity="${s.opacity}"${t}/>`;
  }
}

export function ShapeEditor({ open, onClose, reg, look, onCreated }: { open: boolean; onClose: () => void; reg: Registry; look: Look; onCreated: (id: string) => void }) {
  const { run } = useNexus();
  const L = useL();
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("custom");
  const [colors, setColors] = useState({ primary: "#8b5cf6", secondary: "#f472b6", accent: "#22d3ee", glow: "#fde047" });
  const svg = useMemo(() => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${shapes.map(shapeSvg).join("")}</svg>`, [shapes]);
  const preview = svg.replace(/\{\{(primary|secondary|accent|glow)\}\}/g, (_, k: keyof typeof colors) => colors[k]);
  const add = (type: ShapeType) => {
    const s: Shape = { id: Date.now(), type, x: 100, y: 100, w: 40, h: 40, r: 0, fill: "primary", stroke: "#1b1f2a", sw: 0, opacity: 1 };
    setShapes((x) => [...x, s]);
    setSel(s.id);
  };
  const cur = shapes.find((s) => s.id === sel);
  const upd = (p: Partial<Shape>) => setShapes((x) => x.map((s) => (s.id === sel ? { ...s, ...p } : s)));
  const save = async () => {
    const id = await run(studio.createAsset(svg, { name, category, zIndex: reg.slots.find((s) => s.id === category)?.zDefault ?? 50, tintable: true, mirrorable: true, duplicable: true }, colors), L("Composant créé dans Mes assets", "Component created in My Assets"));
    if (id) { onCreated(id); setShapes([]); setName(""); onClose(); }
  };
  const types: [ShapeType, string][] = [["circle", "●"], ["ellipse", "⬭"], ["rect", "■"], ["triangle", "▲"], ["star", "★"], ["heart", "♥"], ["horn", L("Corne", "Horn")], ["wing", L("Aile", "Wing")], ["tail", L("Queue", "Tail")]];
  return (
    <Modal open={open} onClose={onClose} title={L("Créer un composant", "Create a component")} wide>
      <div className="grid grid-cols-[260px_1fr] gap-4 text-[12px]">
        <div className="relative h-[260px] w-[260px] rounded-xl border border-line bg-[repeating-conic-gradient(rgb(255_255_255/0.03)_0_25%,transparent_0_50%)] [background-size:20px_20px]">
          <div className="absolute inset-0 opacity-35"><Avatar look={look} assets={reg.byId} slots={reg.slots} size={260} motion="off" /></div>
          <img src={svgUrl(preview)} alt="" className="absolute inset-0 h-full w-full" />
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">{types.map(([t, lbl]) => <Button key={t} size="sm" onClick={() => add(t)}>{lbl}</Button>)}</div>
          <div className="flex flex-wrap gap-1">
            {shapes.map((s, i) => (
              <button key={s.id} onClick={() => setSel(s.id)} className={cx("rounded-md border px-2 py-0.5 text-[11px]", s.id === sel ? "border-sky/50 bg-sky/10" : "border-line")}>{i + 1}. {s.type}</button>
            ))}
          </div>
          {cur ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {(["x", "y", "w", "h", "r"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-mute">{k.toUpperCase()}
                  <input type="range" min={k === "r" ? -180 : k === "w" || k === "h" ? 5 : 0} max={k === "r" ? 180 : 200} value={cur[k]} onChange={(e) => upd({ [k]: Number(e.target.value) })} className="flex-1" />
                  <span className="w-8 text-right font-mono text-[10.5px]">{cur[k]}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-mute">{L("Opacité", "Opacity")}<input type="range" min={0.1} max={1} step={0.05} value={cur.opacity} onChange={(e) => upd({ opacity: Number(e.target.value) })} className="flex-1" /></label>
              <label className="flex items-center gap-2 text-mute">{L("Remplissage", "Fill")}
                <Select className="h-7 text-[11px]" value={FILLS.includes(cur.fill) ? cur.fill : "custom"} onChange={(e) => upd({ fill: e.target.value === "custom" ? "#ffffff" : e.target.value })}>
                  {FILLS.map((f) => <option key={f} value={f}>{f}</option>)}<option value="custom">{L("fixe", "fixed")}</option>
                </Select>
                {!FILLS.includes(cur.fill) && <input type="color" value={cur.fill} onChange={(e) => upd({ fill: e.target.value })} />}
              </label>
              <label className="flex items-center gap-2 text-mute">{L("Contour", "Outline")}<input type="range" min={0} max={8} value={cur.sw} onChange={(e) => upd({ sw: Number(e.target.value) })} className="flex-1" /><input type="color" value={cur.stroke.startsWith("#") ? cur.stroke : "#1b1f2a"} onChange={(e) => upd({ stroke: e.target.value })} /></label>
              <div className="col-span-2 flex gap-1">
                <Button size="sm" onClick={() => setShapes((x) => { const i = x.findIndex((s) => s.id === sel); if (i < 0) return x; const c = { ...x[i]!, id: Date.now(), x: 200 - x[i]!.x, r: -x[i]!.r }; return [...x, c]; })}>{L("Dupliquer en miroir", "Mirror duplicate")}</Button>
                <Button size="sm" variant="danger" onClick={() => { setShapes((x) => x.filter((s) => s.id !== sel)); setSel(null); }}>{L("Supprimer la forme", "Delete shape")}</Button>
              </div>
            </div>
          ) : <div className="text-dim">{L("Ajoutez une forme pour commencer.", "Add a shape to start.")}</div>}
          <div className="grid grid-cols-4 gap-1.5 border-t border-line pt-2">
            {FILLS.map((k) => <label key={k} className="flex items-center gap-1 text-[10.5px] text-mute"><input type="color" value={colors[k as keyof typeof colors]} onChange={(e) => setColors({ ...colors, [k]: e.target.value })} />{k}</label>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder={L("Nom du composant", "Component name")} value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>{slotOptions(reg).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          </div>
          <div className="flex justify-end"><Button variant="primary" disabled={!shapes.length || !name.trim()} onClick={save}>{L("Enregistrer dans Mes assets", "Save to My Assets")}</Button></div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- state → expression / animation mapping

export function MappingDialog({ open, onClose, look, onChange, onPreview }: { open: boolean; onClose: () => void; look: Look; onChange: (l: Look) => void; onPreview: (s: CompanionState) => void }) {
  const L = useL();
  return (
    <Modal open={open} onClose={onClose} title={L("Expressions & animations par état", "Expressions & animations per state")} wide>
      <p className="mb-3 text-[11.5px] text-dim">{L("Ces réglages suivent l'état RÉEL de NEXUS. Ils sont indépendants du combo : changer d'expression ne modifie jamais les composants équipés.",
        "These follow NEXUS's REAL state. They are independent from the combo: changing expression never changes the equipped components.")}</p>
      <table className="w-full text-[12px]">
        <thead className="text-[10.5px] uppercase tracking-[0.12em] text-dim"><tr><th className="py-1 text-left">{L("État", "State")}</th><th className="text-left">{L("Expression", "Expression")}</th><th className="text-left">{L("Animation", "Animation")}</th><th /></tr></thead>
        <tbody>
          {STATES.map((s) => (
            <tr key={s} className="border-t border-line">
              <td className="py-1.5 font-mono text-[11px]">{s}</td>
              <td><Select className="h-7 text-[11.5px]" value={String(look.expressionMap[s])} onChange={(e) => onChange({ ...look, expressionMap: { ...look.expressionMap, [s]: e.target.value } })}>{EXPRESSIONS.map((x) => <option key={x}>{x}</option>)}</Select></td>
              <td><Select className="h-7 text-[11.5px]" value={String(look.animationMap[s])} onChange={(e) => onChange({ ...look, animationMap: { ...look.animationMap, [s]: e.target.value } })}>{ANIMATIONS.map((x) => <option key={x}>{x}</option>)}</Select></td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => onPreview(s)}>{L("Aperçu", "Preview")}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------------------------------------------------------------- combos & versions

export function CombosDialog({ open, onClose, reg, look, loaded, onLoad, onSaved }: {
  open: boolean; onClose: () => void; reg: Registry; look: Look;
  loaded: { id: string; name: string } | null;
  onLoad: (data: ComboData, combo: { id: string; name: string }) => void;
  onSaved: (combo: { id: string; name: string }) => void;
}) {
  const { run } = useNexus();
  const L = useL();
  const [list, setList] = useState<ComboSummary[]>([]);
  const [name, setName] = useState("");
  const [withMaps, setWithMaps] = useState(false);
  const [detail, setDetail] = useState<ComboDetail | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const load = () => studio.listCombos().then(setList).catch(() => {});
  useEffect(() => { if (open) { void load(); setName(loaded?.name ?? ""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = (): ComboData => (withMaps ? { layers: look.layers, expressionMap: look.expressionMap, animationMap: look.animationMap } : { layers: look.layers });
  const saveNew = async () => { const r = await run(studio.saveCombo(null, name, data()), L("Combo enregistré", "Combo saved")); if (r) { onSaved({ id: r.id, name }); void load(); } };
  const saveVersion = async () => { if (!loaded) return; const r = await run(studio.saveCombo(loaded.id, loaded.name, data()), L("Nouvelle version enregistrée", "New version saved")); if (r) void load(); };
  const preview = (d: ComboData | null) => normalizeLook({ ...look, ...(d ?? {}), layers: d?.layers ?? [] });
  const exportCombo = async (c: { name: string; data: ComboData | null }) => {
    const dest = await saveDialog({ defaultPath: `${c.name}.nexuscombo.json`, filters: [{ name: "NEXUS combo", extensions: ["json"] }] });
    if (dest && c.data) await run(studio.exportCombo(c.name, c.data, dest), L("Combo exporté", "Combo exported"));
  };
  const importCombo = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: "NEXUS combo", extensions: ["json"] }] });
    if (typeof p !== "string") return;
    const r = await run(studio.importCombo(p));
    if (r) { void load(); onLoad(r.data, { id: r.combo.id, name: "" }); }
  };
  return (
    <Modal open={open} onClose={onClose} title={L("Combos", "Combos")} wide>
      <div className="space-y-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-black/20 p-3">
          <Input className="max-w-xs" placeholder={L("Nom du combo, ex. Dragon Cat", "Combo name, e.g. Dragon Cat")} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" disabled={!name.trim()} onClick={saveNew}>{L("Enregistrer comme nouveau combo", "Save as new combo")}</Button>
          {loaded && <Button onClick={saveVersion}>{L(`Nouvelle version de « ${loaded.name} »`, `New version of "${loaded.name}"`)}</Button>}
          <label className="ml-auto flex items-center gap-2 text-[11.5px] text-mute"><Toggle checked={withMaps} onChange={setWithMaps} />{L("Inclure expressions & animations", "Include expressions & animations")}</label>
          <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={importCombo}>{L("Importer", "Import")}</Button>
        </div>
        {list.length === 0 ? <Empty title={L("Aucun combo", "No combos yet")} /> : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {list.map((c) => (
              <div key={c.id} className={cx("rounded-xl border bg-black/20 p-2", loaded?.id === c.id ? "border-sky/40" : "border-line")}>
                <div className="flex items-center gap-2">
                  <Avatar look={preview(c.data)} assets={reg.byId} slots={reg.slots} size={64} motion="off" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{c.name}</div>
                    <div className="text-[10.5px] text-dim">v{c.currentVersion} · {c.versions} {L("version(s)", "version(s)")} · {fmtTime(c.updatedAt, true)}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="primary" disabled={!c.data} onClick={() => { if (c.data) { onLoad(c.data, { id: c.id, name: c.name }); onClose(); } }}>{L("Charger", "Load")}</Button>
                  <Button size="sm" icon={<History className="h-3 w-3" />} onClick={() => studio.getCombo(c.id).then(setDetail)}>{L("Versions", "Versions")}</Button>
                  <Button size="sm" icon={<Download className="h-3 w-3" />} onClick={() => exportCombo(c)} />
                  {renaming === c.id ? (
                    <Input autoFocus className="h-7 w-32 text-[11.5px]" defaultValue={c.name}
                      onKeyDown={async (e) => { if (e.key === "Enter") { const n = (e.target as HTMLInputElement).value; if (n.trim()) { await run(studio.renameCombo(c.id, n)); void load(); } setRenaming(null); } if (e.key === "Escape") setRenaming(null); }}
                      onBlur={() => setRenaming(null)} />
                  ) : <Button size="sm" variant="ghost" onClick={() => setRenaming(c.id)}>{L("Renommer", "Rename")}</Button>}
                  <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="h-3 w-3" />} confirmLabel={L("Supprimer ?", "Delete?")} onConfirm={async () => { await run(studio.deleteCombo(c.id)); void load(); }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {detail && (
          <div className="rounded-xl border border-line bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between"><span className="font-medium">{detail.name} — {L("versions", "versions")}</span><Button size="sm" variant="ghost" onClick={() => setDetail(null)}>×</Button></div>
            <div className="flex flex-wrap gap-2">
              {detail.versions.map((v) => (
                <div key={v.version} className={cx("rounded-lg border p-2", v.version === detail.currentVersion ? "border-sky/40" : "border-line")}>
                  <Avatar look={preview(v.data)} assets={reg.byId} slots={reg.slots} size={56} motion="off" />
                  <div className="text-center text-[10.5px]">v{v.version}</div>
                  <div className="mt-1 flex gap-1">
                    <Button size="sm" onClick={async () => { const d = await run(studio.restoreVersion(detail.id, v.version)); if (d) { onLoad(d, { id: detail.id, name: detail.name }); setDetail(await studio.getCombo(detail.id)); void load(); } }}>{L("Restaurer", "Restore")}</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await run(studio.duplicateVersion(detail.id, v.version)); setDetail(await studio.getCombo(detail.id)); void load(); }} title={L("Dupliquer", "Duplicate")}><Plus className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await run(studio.deleteVersion(detail.id, v.version)); setDetail(await studio.getCombo(detail.id)); void load(); }} title={L("Supprimer", "Delete")}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- profiles

export function ProfilesDialog({ open, onClose, reg, look, onActivated }: { open: boolean; onClose: () => void; reg: Registry; look: Look; onActivated: (l: Look) => void }) {
  const { run } = useNexus();
  const L = useL();
  const [list, setList] = useState<Profile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState<"s" | "m" | "l">(look.size ?? "m");
  const [withPos, setWithPos] = useState(false);
  const load = () => studio.listProfiles().then((r) => { setList(r.profiles); setActive(r.active); }).catch(() => {});
  useEffect(() => { if (open) void load(); }, [open]);
  const save = async (id: string | null, n: string) => {
    const position = withPos ? await studio.companionPosition() : null;
    await run(studio.saveProfile(id, n, { look: { ...look, size }, size, position }), L("Profil enregistré", "Profile saved"));
    setName("");
    void load();
  };
  return (
    <Modal open={open} onClose={onClose} title={L("Profils du Companion", "Companion profiles")} wide>
      <div className="space-y-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-black/20 p-3">
          <Input className="max-w-[200px]" placeholder={L("Travail, Gaming, Code…", "Work, Gaming, Coding…")} value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={size} onChange={(e) => setSize(e.target.value as "s" | "m" | "l")}><option value="s">{L("Petit", "Small")}</option><option value="m">{L("Moyen", "Medium")}</option><option value="l">{L("Grand", "Large")}</option></Select>
          <label className="flex items-center gap-2 text-mute"><Toggle checked={withPos} onChange={setWithPos} />{L("Mémoriser la position actuelle", "Remember current position")}</label>
          <Button variant="primary" disabled={!name.trim()} onClick={() => save(null, name)}>{L("Créer depuis l'apparence actuelle", "Create from current look")}</Button>
        </div>
        {list.length === 0 ? <Empty title={L("Aucun profil", "No profiles yet")} /> : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {list.map((p) => (
              <div key={p.id} className={cx("flex items-center gap-2 rounded-xl border bg-black/20 p-2", active === p.id ? "border-ok/40" : "border-line")}>
                <Avatar look={normalizeLook(p.data.look)} assets={reg.byId} slots={reg.slots} size={56} motion="off" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name} {active === p.id && <span className="text-[10px] text-ok">· {L("actif", "active")}</span>}</div>
                  <div className="text-[10.5px] text-dim">{L("Taille", "Size")} {p.data.size}{p.data.position ? ` · ${L("position mémorisée", "position saved")}` : ""}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button size="sm" variant="primary" onClick={async () => { const d = await run(studio.activateProfile(p.id), L("Profil activé", "Profile activated")); if (d) { onActivated(normalizeLook(d.look)); void load(); } }}>{L("Activer", "Activate")}</Button>
                    <Button size="sm" onClick={() => save(p.id, p.name)}>{L("Mettre à jour", "Update")}</Button>
                    <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="h-3 w-3" />} confirmLabel="?" onConfirm={async () => { await run(studio.deleteProfile(p.id)); void load(); }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- edit custom asset metadata

export function EditAssetDialog({ assetId, reg, onClose }: { assetId: string | null; reg: Registry; onClose: () => void }) {
  const { run } = useNexus();
  const L = useL();
  const a = assetId ? reg.byId.get(assetId) : undefined;
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [z, setZ] = useState(0);
  const [tintable, setTintable] = useState(false);
  const [mirrorable, setMirrorable] = useState(true);
  useEffect(() => { if (a) { setName(a.name); setCategory(a.category); setZ(a.zIndex ?? 50); setTintable(a.tintable); setMirrorable(a.mirrorable); } }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null;
  return (
    <Modal open={!!assetId} onClose={onClose} title={L("Modifier l'asset", "Edit asset")}>
      <div className="space-y-2 text-[12.5px]">
        <label className="block">{L("Nom", "Name")}<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block">{L("Catégorie", "Category")}<Select className="w-full" value={category} onChange={(e) => setCategory(e.target.value)}>{slotOptions(reg).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select></label>
        <label className="block">{L("Calque (z)", "Layer (z)")}<Input type="number" value={z} onChange={(e) => setZ(Number(e.target.value))} /></label>
        <div className="flex gap-4"><label className="flex items-center gap-2"><Toggle checked={tintable} onChange={setTintable} />{L("Teintable", "Tintable")}</label><label className="flex items-center gap-2"><Toggle checked={mirrorable} onChange={setMirrorable} />{L("Miroir", "Mirror")}</label></div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{L("Annuler", "Cancel")}</Button>
          <Button variant="primary" onClick={async () => { await run(studio.updateAsset(a.id, { name, category, zIndex: z, tintable, mirrorable }), L("Asset modifié", "Asset updated")); onClose(); }}>{L("Enregistrer", "Save")}</Button></div>
      </div>
    </Modal>
  );
}
