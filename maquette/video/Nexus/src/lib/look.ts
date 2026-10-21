// Companion appearance model: a Look is an ordered set of independent layers
// (one per equipped asset) plus state → expression / animation mappings.
// Nothing here is a fixed skin: slots and assets come from the pack registry.

export type CompanionState =
  | "IDLE" | "LISTENING" | "THINKING" | "PLANNING" | "SEARCHING" | "WAITING_PERMISSION"
  | "EXECUTING" | "VERIFYING" | "SUCCESS" | "ERROR" | "STOPPED" | "SLEEPING";

export const STATES: CompanionState[] = [
  "IDLE", "LISTENING", "THINKING", "PLANNING", "SEARCHING", "WAITING_PERMISSION",
  "EXECUTING", "VERIFYING", "SUCCESS", "ERROR", "STOPPED", "SLEEPING",
];

export const EXPRESSIONS = ["normal", "happy", "proud", "focused", "concerned", "curious", "thinking", "surprised", "sleepy", "neutral"] as const;
export const ANIMATIONS = ["none", "float", "breathe", "sway", "bounce", "work", "dance", "pop", "shake", "dizzy", "sleep", "spin"] as const;
export type Expression = (typeof EXPRESSIONS)[number] | string;
export type Animation = (typeof ANIMATIONS)[number] | string;

export type ColorKey = "primary" | "secondary" | "accent" | "glow";
export const COLOR_KEYS: ColorKey[] = ["primary", "secondary", "accent", "glow"];
export type Colors = Partial<Record<ColorKey, string>>;

export interface AssetDef {
  id: string;
  pack: string;
  packName: string;
  custom: boolean;
  supported: boolean;
  unsupportedReason?: string | null;
  variants: string[];
  favorite: boolean;
  lastUsed?: string | null;
  added?: string | null;
  name: string;
  category: string;
  assetType: string;
  source: string;
  zIndex?: number;
  size?: number;
  anchor?: { x: number; y: number };
  scale?: number;
  rotation?: number;
  offset?: { x: number; y: number };
  tintable: boolean;
  colors?: Colors;
  defaultColor?: string;
  mirrorable: boolean;
  duplicable: boolean;
  compatibleBodies?: string[];
  tags: string[];
}

export interface SlotDef {
  id: string;
  name: string;
  icon?: string;
  multiple?: boolean;
  maxItems?: number;
  required?: boolean;
  expressive?: boolean;
  zDefault?: number;
  pack?: string;
}

export interface Layer {
  uid: string;
  assetId: string;
  slot: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  z: number;
  colors: Colors;
  hidden?: boolean;
  locked?: boolean;
}

export interface Look {
  version: 1;
  layers: Layer[];
  expressionMap: Partial<Record<CompanionState, Expression>>;
  animationMap: Partial<Record<CompanionState, Animation>>;
  size?: "s" | "m" | "l";
  personality?: string;
}

export const DEFAULT_EXPRESSIONS: Record<CompanionState, Expression> = {
  IDLE: "normal", LISTENING: "curious", THINKING: "thinking", PLANNING: "focused", SEARCHING: "curious",
  WAITING_PERMISSION: "surprised", EXECUTING: "focused", VERIFYING: "focused", SUCCESS: "happy",
  ERROR: "concerned", STOPPED: "neutral", SLEEPING: "sleepy",
};
export const DEFAULT_ANIMATIONS: Record<CompanionState, Animation> = {
  IDLE: "float", LISTENING: "breathe", THINKING: "sway", PLANNING: "float", SEARCHING: "sway",
  WAITING_PERMISSION: "bounce", EXECUTING: "work", VERIFYING: "float", SUCCESS: "dance",
  ERROR: "shake", STOPPED: "none", SLEEPING: "sleep",
};

export const SIZE_PX = { s: 0.8, m: 1, l: 1.25 } as const;

let uidCounter = 0;
export function newUid() {
  uidCounter += 1;
  return `l${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function layerFromAsset(a: AssetDef, slots: SlotDef[]): Layer {
  const slot = slots.find((s) => s.id === a.category);
  return {
    uid: newUid(),
    assetId: a.id,
    slot: a.category,
    x: a.offset?.x ?? 0,
    y: a.offset?.y ?? 0,
    scale: a.scale ?? 1,
    rotation: a.rotation ?? 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    z: a.zIndex ?? slot?.zDefault ?? 50,
    colors: {},
  };
}

export function defaultLook(): Look {
  // y offsets match the builtin manifest's `offset` for these assets.
  const part = (assetId: string, slot: string, z: number, y = 0): Layer => ({ uid: newUid(), assetId, slot, x: 0, y, scale: 1, rotation: 0, flipX: false, flipY: false, opacity: 1, z, colors: {} });
  return {
    version: 1,
    layers: [
      part("builtin/nexus_blob", "body", 0),
      part("builtin/floaty_fins", "arms", -3),
      part("builtin/blob_eyes", "eyes", 60, 5),
      part("builtin/tiny_mouth", "mouth", 62, 5),
      part("builtin/status_badges", "status", 120, 10),
    ],
    expressionMap: { ...DEFAULT_EXPRESSIONS },
    animationMap: { ...DEFAULT_ANIMATIONS },
    size: "m",
  };
}

/** Repairs looks loaded from storage or imported files (never drops layers). */
export function normalizeLook(v: unknown): Look {
  const base = defaultLook();
  if (!v || typeof v !== "object") return base;
  const o = v as Partial<Look>;
  const layers = Array.isArray(o.layers) ? o.layers.filter((l) => l && typeof l.assetId === "string").map((l) => ({
    uid: typeof l.uid === "string" ? l.uid : newUid(),
    assetId: l.assetId,
    slot: typeof l.slot === "string" ? l.slot : "custom",
    x: Number.isFinite(l.x) ? l.x : 0,
    y: Number.isFinite(l.y) ? l.y : 0,
    scale: Number.isFinite(l.scale) && l.scale > 0 ? l.scale : 1,
    rotation: Number.isFinite(l.rotation) ? l.rotation : 0,
    flipX: !!l.flipX,
    flipY: !!l.flipY,
    opacity: Number.isFinite(l.opacity) ? Math.min(1, Math.max(0, l.opacity)) : 1,
    z: Number.isFinite(l.z) ? l.z : 50,
    colors: typeof l.colors === "object" && l.colors ? l.colors : {},
    hidden: !!l.hidden,
    locked: !!l.locked,
  })) : base.layers;
  // The untouched old default (robot) is upgraded to the current default blob;
  // any look the user changed is kept as is.
  const legacy = layers.length === 2 && layers.some((l) => l.assetId === "builtin/nexus_bot") && layers.some((l) => l.assetId === "builtin/nexus_eyes")
    && layers.every((l) => !l.x && !l.y && l.scale === 1 && !l.rotation && Object.keys(l.colors).length === 0);
  return {
    version: 1,
    layers: legacy ? base.layers : layers,
    expressionMap: { ...DEFAULT_EXPRESSIONS, ...(o.expressionMap ?? {}) },
    animationMap: { ...DEFAULT_ANIMATIONS, ...(o.animationMap ?? {}) },
    size: o.size === "s" || o.size === "l" ? o.size : "m",
    personality: o.personality,
  };
}

/** Equip: single-item slots replace their current item; multi-item slots append. */
export function equip(look: Look, asset: AssetDef, slots: SlotDef[]): Look {
  const slot = slots.find((s) => s.id === asset.category);
  const layer = layerFromAsset(asset, slots);
  let layers = look.layers;
  if (slot && slot.multiple === false) {
    const prev = layers.find((l) => l.slot === slot.id);
    if (prev) {
      // Keep the user's placement/colours where it makes sense.
      layer.x = prev.x;
      layer.y = prev.y;
      layer.flipX = prev.flipX;
      layer.flipY = prev.flipY;
    }
    layers = layers.filter((l) => l.slot !== slot.id);
  } else if (slot?.maxItems && layers.filter((l) => l.slot === slot.id).length >= slot.maxItems) {
    throw new Error(`The slot "${slot.name}" accepts at most ${slot.maxItems} item(s).`);
  }
  return { ...look, layers: [...layers, layer] };
}

export function sortedLayers(look: Look) {
  return look.layers.map((l, i) => ({ l, i })).sort((a, b) => a.l.z - b.l.z || a.i - b.i).map((x) => x.l);
}

export function resolveColors(layer: Layer, asset: AssetDef | undefined): Required<Colors> {
  const d = asset?.colors ?? {};
  const fallback = asset?.defaultColor;
  return {
    primary: layer.colors.primary ?? d.primary ?? fallback ?? "#ffffff",
    secondary: layer.colors.secondary ?? d.secondary ?? d.primary ?? "#cccccc",
    accent: layer.colors.accent ?? d.accent ?? d.primary ?? "#8fd3ff",
    glow: layer.colors.glow ?? d.glow ?? d.accent ?? d.primary ?? "#8fd3ff",
  };
}

export function applyColors(svg: string, c: Required<Colors>) {
  return svg.replace(/\{\{(primary|secondary|accent|glow)\}\}/g, (_, k: ColorKey) => c[k]);
}

export function expressionFor(look: Look, state: CompanionState): Expression {
  return look.expressionMap[state] ?? DEFAULT_EXPRESSIONS[state];
}
export function animationFor(look: Look, state: CompanionState): Animation {
  return look.animationMap[state] ?? DEFAULT_ANIMATIONS[state];
}

/** Parses #rgb, #rrggbb, rgb(), hsl() into #rrggbb, or null. */
export function parseColor(input: string): string | null {
  const s = input.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1]!;
    return "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (rgb) return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  const hsl = /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/.exec(s);
  if (hsl) return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  return null;
}

export function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100, li = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(li, 1 - li);
  const f = (n: number) => li - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string) {
  const h = parseColor(hex) ?? "#000000";
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

// ---------------------------------------------------------------- randomizer

export type RandomMode = "everything" | "accessories" | "colors" | "effects" | "head" | "body" | "animation";
const ACCESSORY_SLOTS = ["glasses", "headwear", "face", "neck", "back", "body_accessories", "pet", "arms", "legs", "shoes"];
const HEAD_SLOTS = ["eyes", "mouth", "ears", "horns", "headwear", "glasses", "face"];
const EFFECT_SLOTS = ["effects", "particles", "aura", "lighting"];

function pick<T>(arr: T[], rnd: () => number): T | undefined {
  return arr.length ? arr[Math.floor(rnd() * arr.length)] : undefined;
}
function randomHex(rnd: () => number) {
  return hslToHex(Math.floor(rnd() * 360), 55 + Math.floor(rnd() * 35), 45 + Math.floor(rnd() * 25));
}

/**
 * Locked slots are never touched. Only supported assets are used.
 * `rnd` is injectable for tests.
 */
export function randomize(look: Look, mode: RandomMode, assets: AssetDef[], slots: SlotDef[], locked: Set<string>, rnd: () => number = Math.random): Look {
  const usable = assets.filter((a) => a.supported);
  const bySlot = (s: string) => usable.filter((a) => a.category === s);
  const targetSlots = (() => {
    switch (mode) {
      case "everything": return slots.map((s) => s.id);
      case "accessories": return ACCESSORY_SLOTS;
      case "effects": return EFFECT_SLOTS;
      case "head": return HEAD_SLOTS;
      case "body": return ["body"];
      default: return [];
    }
  })().filter((s) => !locked.has(s));

  let layers = look.layers.filter((l) => !targetSlots.includes(l.slot));
  for (const sid of targetSlots) {
    const slot = slots.find((s) => s.id === sid);
    const choices = bySlot(sid);
    if (!choices.length) continue;
    const essential = sid === "body" || sid === "eyes";
    const chance = essential ? 1 : mode === "everything" ? 0.4 : 0.6;
    if (rnd() > chance) continue;
    const count = slot?.multiple && sid === "effects" && rnd() > 0.7 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const a = pick(choices, rnd);
      if (a && !layers.some((l) => l.assetId === a.id)) layers.push(layerFromAsset(a, slots));
    }
  }
  let next: Look = { ...look, layers };
  if (mode === "colors" || mode === "everything") {
    next = {
      ...next,
      layers: next.layers.map((l) => {
        if (locked.has(l.slot)) return l;
        const a = assets.find((x) => x.id === l.assetId);
        if (!a?.tintable) return l;
        return { ...l, colors: { primary: randomHex(rnd), secondary: randomHex(rnd), accent: randomHex(rnd) } };
      }),
    };
  }
  if (mode === "animation" || mode === "everything") {
    if (!locked.has("animation")) {
      const anims = ANIMATIONS.filter((a) => a !== "none");
      next = { ...next, animationMap: { ...next.animationMap, IDLE: pick([...anims], rnd)!, SUCCESS: pick(["dance", "pop", "spin", "bounce"], rnd)! } };
    }
  }
  return next;
}

// ---------------------------------------------------------------- personality presets (starting points)

export const PRESETS: Record<string, { fr: string; en: string; apply: (l: Look) => Look }> = {
  cute: { fr: "Mignon", en: "Cute", apply: (l) => ({ ...l, personality: "cute", animationMap: { ...l.animationMap, IDLE: "bounce", SUCCESS: "dance", ERROR: "dizzy" }, expressionMap: { ...l.expressionMap, IDLE: "happy", SUCCESS: "proud" } }) },
  cyber: { fr: "Cyber", en: "Cyber", apply: (l) => ({ ...l, personality: "cyber", animationMap: { ...l.animationMap, IDLE: "breathe", EXECUTING: "work", SUCCESS: "pop" }, expressionMap: { ...l.expressionMap, IDLE: "focused" } }) },
  minimal: { fr: "Minimal", en: "Minimal", apply: (l) => ({ ...l, personality: "minimal", animationMap: Object.fromEntries(STATES.map((s) => [s, s === "WAITING_PERMISSION" ? "bounce" : "none"])), expressionMap: { ...DEFAULT_EXPRESSIONS } }) },
  funny: { fr: "Drôle", en: "Funny", apply: (l) => ({ ...l, personality: "funny", animationMap: { ...l.animationMap, IDLE: "sway", THINKING: "spin", SUCCESS: "dance", ERROR: "dizzy" }, expressionMap: { ...l.expressionMap, THINKING: "surprised", ERROR: "surprised" } }) },
  professional: { fr: "Professionnel", en: "Professional", apply: (l) => ({ ...l, personality: "professional", animationMap: { ...l.animationMap, IDLE: "breathe", SUCCESS: "pop", ERROR: "none" }, expressionMap: { ...l.expressionMap, IDLE: "neutral", SUCCESS: "happy" } }) },
  chaotic: { fr: "Chaotique", en: "Chaotic", apply: (l) => ({ ...l, personality: "chaotic", animationMap: Object.fromEntries(STATES.map((s, i) => [s, ANIMATIONS[(i * 5) % ANIMATIONS.length]!])) }) },
  sleepy: { fr: "Endormi", en: "Sleepy", apply: (l) => ({ ...l, personality: "sleepy", animationMap: { ...l.animationMap, IDLE: "sleep", LISTENING: "breathe" }, expressionMap: { ...l.expressionMap, IDLE: "sleepy", THINKING: "sleepy" } }) },
  gaming: { fr: "Gaming", en: "Gaming", apply: (l) => ({ ...l, personality: "gaming", animationMap: { ...l.animationMap, IDLE: "bounce", EXECUTING: "work", SUCCESS: "spin" }, expressionMap: { ...l.expressionMap, EXECUTING: "focused", SUCCESS: "proud" } }) },
};
