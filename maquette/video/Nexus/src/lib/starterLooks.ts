// Ready-made starting points built from builtin assets. Each one is a plain
// layer configuration (like a combo), never a flattened image: once applied,
// every part stays individually editable.
import { layerFromAsset, type AssetDef, type Colors, type Look, type SlotDef } from "./look";

type Part = string | { id: string; colors?: Colors };
export interface StarterLook { id: string; fr: string; en: string; parts: Part[] }

const BLOB: Part[] = ["nexus_blob", "floaty_fins", "blob_eyes", "tiny_mouth", "status_badges"];
const tinted = (id: string, colors: Colors): Part => ({ id, colors });

export const STARTER_LOOKS: StarterLook[] = [
  { id: "blob", fr: "NEXUS Blob", en: "NEXUS Blob", parts: BLOB },
  { id: "cat", fr: "Chat", en: "Cat", parts: [...BLOB, "soft_cat_ears", "cat_whiskers"] },
  { id: "astronaut", fr: "Astronaute", en: "Astronaut", parts: [...BLOB, "astronaut_helmet"] },
  { id: "witch", fr: "Sorcier", en: "Witch", parts: [...BLOB, "witch_hat"] },
  { id: "king", fr: "Roi", en: "King", parts: [...BLOB, "glow_crown"] },
  { id: "cool", fr: "Cool", en: "Cool", parts: [...BLOB, "sunglasses"] },
  { id: "party", fr: "Fête", en: "Party", parts: [...BLOB, "party_hat"] },
  { id: "pumpkin", fr: "Citrouille", en: "Pumpkin", parts: ["pumpkin_blob", "floaty_fins", "blob_eyes", "tiny_mouth", "status_badges"] },
  { id: "winter", fr: "Hiver", en: "Winter", parts: [...BLOB, "beanie", "snow"] },
  { id: "gamer", fr: "Gamer", en: "Gamer", parts: [...BLOB, "gaming_headset"] },
  { id: "galaxy", fr: "Galaxie", en: "Galaxy", parts: ["galaxy_blob", tinted("floaty_fins", { primary: "#8f7bff", secondary: "#3b2fa8" }), tinted("blob_eyes", { primary: "#e9e6ff" }), tinted("tiny_mouth", { primary: "#e9e6ff" }), "status_badges"] },
  { id: "slime", fr: "Slime", en: "Slime", parts: ["slime_blob", tinted("floaty_fins", { primary: "#a8f0a0", secondary: "#4cc46a" }), "blob_eyes", "tiny_mouth", "status_badges"] },
  { id: "angel", fr: "Ange", en: "Angel", parts: [...BLOB, "glow_halo", "angel_fins"] },
  { id: "devil", fr: "Diablotin", en: "Devil", parts: [...BLOB, "devil_horns", "demon_tail"] },
  { id: "dragon", fr: "Dragon", en: "Dragon", parts: [tinted("nexus_blob", { primary: "#3fc4c0", secondary: "#1e7f8a", accent: "#9ff5e8", glow: "#2fd0c8" }), "dragon_horns", "mini_bat_wings", "blob_eyes", "tiny_mouth", "status_badges"] },
  { id: "ghost", fr: "Fantôme", en: "Ghost", parts: ["glow_ghost", "blob_eyes", "tiny_mouth", "status_badges", "tiny_ghost"] },
  { id: "love", fr: "Amour", en: "Love", parts: [tinted("nexus_blob", { primary: "#ffd6ea", secondary: "#ff8fc0", glow: "#ff6fb0" }), "floaty_fins", "blob_eyes", "tiny_mouth", "status_badges", "hearts"] },
  { id: "dragon_cat", fr: "Dragon Cat", en: "Dragon Cat", parts: [...BLOB, "cat_ears", "dragon_wings", "demon_tail", "crown", "round_glasses", "purple_aura", "stars"] },
];

/** Builds the look; parts whose asset is missing are skipped and reported. */
export function applyStarter(look: Look, s: StarterLook, byId: Map<string, AssetDef>, slots: SlotDef[]): { look: Look; missing: string[] } {
  const missing: string[] = [];
  const layers = s.parts.flatMap((p) => {
    const id = typeof p === "string" ? p : p.id;
    const a = byId.get(`builtin/${id}`);
    if (!a) { missing.push(id); return []; }
    const l = layerFromAsset(a, slots);
    return [{ ...l, colors: typeof p === "string" ? {} : { ...(p.colors ?? {}) } }];
  });
  return { look: { ...look, layers }, missing };
}
