// Simple customisation model: the creature's shape is fixed (body, fins, eyes,
// mouth, state badges always at their designed place); the user only picks a
// colour, a body style and an outfit.
import { defaultLook, layerFromAsset, type AssetDef, type Colors, type Layer, type Look, type SlotDef } from "./look";

export const CORE_SLOTS = ["body", "arms", "eyes", "mouth", "status"];
const CORE_DEFAULTS: Record<string, string> = {
  arms: "builtin/floaty_fins", eyes: "builtin/blob_eyes", mouth: "builtin/tiny_mouth", status: "builtin/status_badges",
};

/** Body styles sharing the exact same silhouette. */
export const SKINS = [
  { id: "builtin/nexus_blob", fr: "Classique", en: "Classic" },
  { id: "builtin/galaxy_blob", fr: "Galaxie", en: "Galaxy" },
  { id: "builtin/slime_blob", fr: "Slime", en: "Slime" },
  { id: "builtin/pumpkin_blob", fr: "Citrouille", en: "Pumpkin" },
];

export const OUTFIT_GROUPS: { id: string; fr: string; en: string; slots: string[]; single?: boolean; custom?: boolean }[] = [
  { id: "hats", fr: "Chapeaux", en: "Hats", slots: ["headwear"], single: true },
  { id: "glasses", fr: "Lunettes", en: "Glasses", slots: ["glasses"], single: true },
  { id: "ears", fr: "Oreilles & cornes", en: "Ears & horns", slots: ["ears", "horns"] },
  { id: "face", fr: "Visage & cou", en: "Face & neck", slots: ["face", "neck"] },
  { id: "wings", fr: "Ailes & queue", en: "Wings & tail", slots: ["wings", "tail", "back"] },
  { id: "effects", fr: "Effets", en: "Effects", slots: ["effects", "particles", "aura", "pet"] },
  // The user's own imported/created assets, whatever their slot.
  { id: "mine", fr: "Mes assets", en: "My assets", slots: [], custom: true },
];
const OUTFIT_SLOTS = new Set([...OUTFIT_GROUPS.flatMap((g) => g.slots), "custom"]);
const isOutfit = (l: Layer, byId: Map<string, AssetDef>) => OUTFIT_SLOTS.has(l.slot) || !!byId.get(l.assetId)?.custom;

export interface ColorPreset { id: string; swatch: string; body: Colors; fins: Colors; face?: string }

/** The palette from the reference design. */
export const COLOR_PRESETS: ColorPreset[] = [
  { id: "white", swatch: "#e8eeff", body: { primary: "#f4f2ff", secondary: "#c7c3ff", accent: "#9cc0ff", glow: "#6f9bff" }, fins: { primary: "#dcd8ff", secondary: "#9fe3ff", glow: "#7aa2ff" } },
  { id: "blue", swatch: "#7c9cff", body: { primary: "#dbe6ff", secondary: "#7c9cff", accent: "#a9c4ff", glow: "#4f7bff" }, fins: { primary: "#c6d6ff", secondary: "#7cc4ff", glow: "#4f7bff" } },
  { id: "lavender", swatch: "#b79cff", body: { primary: "#ece0ff", secondary: "#b28cff", accent: "#d7c2ff", glow: "#9b6bff" }, fins: { primary: "#e2d4ff", secondary: "#c4a6ff", glow: "#9b6bff" } },
  { id: "pink", swatch: "#ff9ad0", body: { primary: "#ffd6ea", secondary: "#ff8fc0", accent: "#ffc2dd", glow: "#ff6fb0" }, fins: { primary: "#ffd0e6", secondary: "#ff9fd0", glow: "#ff6fb0" } },
  { id: "rose", swatch: "#ffc2dc", body: { primary: "#ffe8f2", secondary: "#ffb3d2", accent: "#ffd6e8", glow: "#ff9cc7" }, fins: { primary: "#ffe0ee", secondary: "#ffc2dc", glow: "#ff9cc7" } },
  { id: "mint", swatch: "#7de3c8", body: { primary: "#dcfff6", secondary: "#7fe0d0", accent: "#b8f5e9", glow: "#4fd9c0" }, fins: { primary: "#cdf7ee", secondary: "#8ff0dc", glow: "#4fd9c0" } },
  { id: "teal", swatch: "#3fc4c0", body: { primary: "#3fc4c0", secondary: "#1e7f8a", accent: "#9ff5e8", glow: "#2fd0c8" }, fins: { primary: "#7fe6e0", secondary: "#2fb5b0", glow: "#2fd0c8" } },
  { id: "night", swatch: "#2a2f55", body: { primary: "#2a2f55", secondary: "#12142a", accent: "#5b6cff", glow: "#5b6cff" }, fins: { primary: "#6f7cff", secondary: "#2d3270", glow: "#5b6cff" }, face: "#e9e6ff" },
  { id: "shadow", swatch: "#2a2d3a", body: { primary: "#2a2d3a", secondary: "#12131a", accent: "#6b7090", glow: "#8a90b0" }, fins: { primary: "#4a4f66", secondary: "#23263a", glow: "#8a90b0" }, face: "#f2f2f8" },
];

function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** A preset derived from any colour (custom picker). */
export function customPreset(hex: string): ColorPreset {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "#7c9cff";
  const primary = mix(c, "#ffffff", 0.6);
  return {
    id: "custom", swatch: c,
    body: { primary, secondary: c, accent: mix(c, "#ffffff", 0.35), glow: c },
    fins: { primary: mix(c, "#ffffff", 0.5), secondary: c, glow: c },
    face: luminance(primary) < 0.35 ? "#f2f2f8" : undefined,
  };
}

/** Current colour of the creature (body primary), for highlighting the active swatch. */
export function currentColor(look: Look): string | undefined {
  return look.layers.find((l) => l.slot === "body")?.colors.primary;
}

function place(a: AssetDef, slots: SlotDef[], colors: Colors = {}): Layer {
  return { ...layerFromAsset(a, slots), colors };
}

/**
 * Rebuilds a look with the fixed creature: core parts at their designed place
 * and outfit items reset to their default placement. Colours are kept.
 */
export function simplify(look: Look, byId: Map<string, AssetDef>, slots: SlotDef[]): Look {
  const keep = (slot: string) => look.layers.find((l) => l.slot === slot);
  const body = keep("body");
  const bodyId = body && SKINS.some((s) => s.id === body.assetId) ? body.assetId : SKINS[0]!.id;
  const core: Layer[] = [];
  for (const [slot, id] of [["body", bodyId], ...Object.entries(CORE_DEFAULTS)] as [string, string][]) {
    const a = byId.get(id);
    if (a) core.push(place(a, slots, keep(slot)?.colors ?? {}));
  }
  const outfit = look.layers
    .filter((l) => isOutfit(l, byId) && !CORE_SLOTS.includes(l.slot))
    .flatMap((l) => { const a = byId.get(l.assetId); return a ? [place(a, slots, l.colors)] : []; });
  return { ...look, layers: [...core, ...outfit] };
}

export function applyColor(look: Look, p: ColorPreset): Look {
  return {
    ...look,
    layers: look.layers.map((l) => {
      if (l.slot === "body") return { ...l, colors: { ...p.body } };
      if (l.slot === "arms") return { ...l, colors: { ...p.fins } };
      if (l.slot === "eyes" || l.slot === "mouth") return { ...l, colors: p.face ? { primary: p.face } : {} };
      return l;
    }),
  };
}

export function setSkin(look: Look, skinId: string, byId: Map<string, AssetDef>, slots: SlotDef[]): Look {
  const a = byId.get(skinId);
  if (!a) return look;
  // A new style starts from its own colours.
  return { ...look, layers: look.layers.map((l) => (l.slot === "body" ? place(a, slots) : l.slot === "arms" ? { ...l, colors: {} } : l)) };
}

export function toggleOutfit(look: Look, a: AssetDef, slots: SlotDef[]): Look {
  if (look.layers.some((l) => l.assetId === a.id)) return { ...look, layers: look.layers.filter((l) => l.assetId !== a.id) };
  const group = OUTFIT_GROUPS.find((g) => g.slots.includes(a.category));
  const layers = group?.single ? look.layers.filter((l) => l.slot !== a.category) : look.layers;
  return { ...look, layers: [...layers, place(a, slots)] };
}

const inGroup = (g: (typeof OUTFIT_GROUPS)[number], a: AssetDef | undefined, slot: string) =>
  g.custom ? !!a?.custom : g.slots.includes(slot) && !a?.custom;

export function clearGroup(look: Look, groupId: string, byId: Map<string, AssetDef> = new Map()): Look {
  const g = OUTFIT_GROUPS.find((x) => x.id === groupId);
  return g ? { ...look, layers: look.layers.filter((l) => CORE_SLOTS.includes(l.slot) || !inGroup(g, byId.get(l.assetId), l.slot)) } : look;
}

export function outfitAssets(assets: AssetDef[], groupId: string) {
  const g = OUTFIT_GROUPS.find((x) => x.id === groupId);
  return g ? assets.filter((a) => a.supported && !CORE_SLOTS.includes(a.category) && inGroup(g, a, a.category)) : [];
}

/** What the randomizer may change; locked keys are kept as they are. */
export const RANDOM_KEYS = ["color", "style", ...OUTFIT_GROUPS.filter((g) => !g.custom).map((g) => g.id)];

export function randomizeSimple(look: Look, locked: Set<string>, assets: AssetDef[], byId: Map<string, AssetDef>, slots: SlotDef[], rnd: () => number = Math.random): Look {
  let next = look;
  if (!locked.has("style")) {
    const skins = SKINS.filter((s) => byId.has(s.id));
    const s = skins[Math.floor(rnd() * skins.length)];
    if (s) {
      const keep = new Map(next.layers.filter((l) => l.slot === "body" || l.slot === "arms").map((l) => [l.slot, l.colors]));
      next = setSkin(next, s.id, byId, slots);
      // A locked colour survives the change of style.
      if (locked.has("color")) next = { ...next, layers: next.layers.map((l) => (keep.has(l.slot) ? { ...l, colors: keep.get(l.slot)! } : l)) };
    }
  }
  if (!locked.has("color")) next = applyColor(next, COLOR_PRESETS[Math.floor(rnd() * COLOR_PRESETS.length)]!);
  for (const g of OUTFIT_GROUPS) {
    if (g.custom || locked.has(g.id)) continue;
    next = clearGroup(next, g.id, byId);
    const items = outfitAssets(assets, g.id);
    // About half the groups stay empty so looks don't get overloaded.
    if (!items.length || rnd() < 0.55) continue;
    next = toggleOutfit(next, items[Math.floor(rnd() * items.length)]!, slots);
  }
  return next;
}

export function simpleDefault(byId: Map<string, AssetDef>, slots: SlotDef[]): Look {
  return simplify(defaultLook(), byId, slots);
}
