import { describe, expect, it } from "vitest";
import { applyColors, defaultLook, equip, normalizeLook, parseColor, randomize, resolveColors, sortedLayers, type AssetDef, type SlotDef } from "./look";

const slots: SlotDef[] = [
  { id: "body", name: "Body", multiple: false, zDefault: 0 },
  { id: "eyes", name: "Eyes", multiple: false, zDefault: 60 },
  { id: "wings", name: "Wings", multiple: true, zDefault: -10 },
  { id: "headwear", name: "Headwear", multiple: true, zDefault: 80 },
  { id: "aura", name: "Aura", multiple: true, zDefault: -20 },
];
const asset = (id: string, category: string, extra: Partial<AssetDef> = {}): AssetDef => ({
  id: `builtin/${id}`, pack: "builtin", packName: "Base", custom: false, supported: true, variants: [], favorite: false,
  name: id, category, assetType: "svg", source: `${id}.svg`, tintable: true, mirrorable: true, duplicable: true, tags: [], ...extra,
});

describe("legacy default upgrade", () => {
  const bot = (extra = {}) => ({ uid: "a", assetId: "builtin/nexus_bot", slot: "body", x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false, opacity: 1, z: 0, colors: {}, ...extra });
  const eyes = { uid: "b", assetId: "builtin/nexus_eyes", slot: "eyes", x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false, opacity: 1, z: 60, colors: {} };
  it("turns the untouched old robot default into the blob", () => {
    expect(normalizeLook({ layers: [bot(), eyes] }).layers.map((l) => l.assetId)).toContain("builtin/nexus_blob");
  });
  it("keeps a robot the user customised", () => {
    const l = normalizeLook({ layers: [bot({ colors: { primary: "#ff0000" } }), eyes] });
    expect(l.layers.map((x) => x.assetId)).toEqual(["builtin/nexus_bot", "builtin/nexus_eyes"]);
  });
});

describe("layer composition", () => {
  it("equips several items independently (Dragon Cat)", () => {
    let l = { ...defaultLook(), layers: [] as ReturnType<typeof defaultLook>["layers"] };
    for (const a of [asset("white_blob", "body"), asset("dragon_wings", "wings"), asset("crown", "headwear"), asset("purple_aura", "aura")]) l = equip(l, a, slots);
    expect(l.layers.map((x) => x.assetId)).toEqual(["builtin/white_blob", "builtin/dragon_wings", "builtin/crown", "builtin/purple_aura"]);
    // Removing one leaves the others.
    const noCrown = { ...l, layers: l.layers.filter((x) => x.assetId !== "builtin/crown") };
    expect(noCrown.layers).toHaveLength(3);
    // Rendering order follows z, not insertion order.
    expect(sortedLayers(l).map((x) => x.slot)).toEqual(["aura", "wings", "body", "headwear"]);
  });

  it("single-item slots replace, multi-item slots accumulate", () => {
    let l = defaultLook();
    l = equip(l, asset("white_blob", "body"), slots);
    expect(l.layers.filter((x) => x.slot === "body").map((x) => x.assetId)).toEqual(["builtin/white_blob"]);
    l = equip(l, asset("dragon_wings", "wings"), slots);
    l = equip(l, asset("angel_wings", "wings"), slots);
    expect(l.layers.filter((x) => x.slot === "wings")).toHaveLength(2);
  });

  it("enforces maxItems only when a slot declares it", () => {
    const limited: SlotDef[] = [...slots, { id: "pet", name: "Pet", multiple: true, maxItems: 1 }];
    const l = equip(defaultLook(), asset("ghost", "pet"), limited);
    expect(() => equip(l, asset("ghost2", "pet"), limited)).toThrow();
  });
});

describe("colours", () => {
  it("substitutes tint placeholders", () => {
    const a = asset("w", "wings", { colors: { primary: "#d6304a", secondary: "#7a0f22" } });
    const l = { ...equip(defaultLook(), a, slots).layers.at(-1)!, colors: { primary: "#7c3aed" } };
    const c = resolveColors(l, a);
    expect(c.primary).toBe("#7c3aed");
    expect(c.secondary).toBe("#7a0f22");
    expect(applyColors('<path fill="{{primary}}" stroke="{{secondary}}"/>', c)).toBe('<path fill="#7c3aed" stroke="#7a0f22"/>');
  });

  it("parses hex, rgb and hsl", () => {
    expect(parseColor("#abc")).toBe("#aabbcc");
    expect(parseColor("rgb(124, 58, 237)")).toBe("#7c3aed");
    expect(parseColor("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(parseColor("nope")).toBeNull();
  });
});

describe("randomizer & persistence", () => {
  it("never touches locked slots", () => {
    const assets = [asset("white_blob", "body"), asset("cube", "body"), asset("dragon_wings", "wings"), asset("angel_wings", "wings"), asset("crown", "headwear")];
    const start = equip(equip(defaultLook(), assets[0]!, slots), assets[2]!, slots);
    const bodyBefore = start.layers.find((x) => x.slot === "body")!;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20; i++) {
      const r = randomize(start, "everything", assets, slots, new Set(["body"]), rnd);
      expect(r.layers.find((x) => x.slot === "body")).toEqual(bodyBefore);
    }
  });

  it("normalises stored looks without dropping unknown assets", () => {
    const n = normalizeLook({ layers: [{ assetId: "custom/my_wings", slot: "wings", x: 5 }, { nope: 1 }] });
    expect(n.layers).toHaveLength(1);
    expect(n.layers[0]!.assetId).toBe("custom/my_wings");
    expect(n.layers[0]!.scale).toBe(1);
    expect(n.expressionMap.SUCCESS).toBe("happy");
  });
});

describe("simple studio", async () => {
  const { simplify, applyColor, toggleOutfit, COLOR_PRESETS, setSkin } = await import("./simpleLook");
  const sl: SlotDef[] = [...slots, { id: "arms", name: "Arms", multiple: true }, { id: "mouth", name: "Mouth", multiple: false }, { id: "status", name: "Status", multiple: false }, { id: "glasses", name: "Glasses", multiple: true }];
  const lib = [
    asset("nexus_blob", "body"), asset("galaxy_blob", "body"), asset("floaty_fins", "arms"), asset("blob_eyes", "eyes", { offset: { x: 0, y: 5 } }), asset("tiny_mouth", "mouth"),
    asset("status_badges", "status"), asset("crown", "headwear", { offset: { x: 0, y: 13 } }), asset("witch_hat", "headwear"), asset("sunglasses", "glasses"),
  ];
  const byId = new Map(lib.map((a) => [a.id, a]));
  it("puts the creature back in its fixed shape, keeping colours and outfit", () => {
    const moved = { ...defaultLook(), layers: defaultLook().layers.map((l) => ({ ...l, x: 40, rotation: 30, scale: 2, colors: l.slot === "body" ? { primary: "#ff0000" } : {} })) };
    moved.layers.push({ ...moved.layers[0]!, uid: "c", assetId: "builtin/crown", slot: "headwear", x: 99 });
    const s = simplify(moved, byId, sl);
    expect(s.layers.every((l) => l.x === 0 && l.rotation === 0 && l.scale === 1)).toBe(true);
    expect(s.layers.find((l) => l.slot === "eyes")!.y).toBe(5);
    expect(s.layers.find((l) => l.slot === "headwear")!.y).toBe(13);
    expect(s.layers.find((l) => l.slot === "body")!.colors.primary).toBe("#ff0000");
  });
  it("colour presets recolour body and fins only", () => {
    const s = applyColor(simplify(defaultLook(), byId, sl), COLOR_PRESETS[3]!);
    expect(s.layers.find((l) => l.slot === "body")!.colors).toEqual(COLOR_PRESETS[3]!.body);
    expect(s.layers.find((l) => l.slot === "arms")!.colors).toEqual(COLOR_PRESETS[3]!.fins);
  });
  it("a hat replaces the previous hat; glasses toggle on and off", () => {
    let s = simplify(defaultLook(), byId, sl);
    s = toggleOutfit(s, byId.get("builtin/crown")!, sl);
    s = toggleOutfit(s, byId.get("builtin/witch_hat")!, sl);
    expect(s.layers.filter((l) => l.slot === "headwear").map((l) => l.assetId)).toEqual(["builtin/witch_hat"]);
    s = toggleOutfit(s, byId.get("builtin/sunglasses")!, sl);
    expect(s.layers.some((l) => l.assetId === "builtin/sunglasses")).toBe(true);
    s = toggleOutfit(s, byId.get("builtin/sunglasses")!, sl);
    expect(s.layers.some((l) => l.assetId === "builtin/sunglasses")).toBe(false);
  });
  it("changing style swaps only the body", () => {
    const s = setSkin(simplify(defaultLook(), byId, sl), "builtin/galaxy_blob", byId, sl);
    expect(s.layers.filter((l) => l.slot === "body").map((l) => l.assetId)).toEqual(["builtin/galaxy_blob"]);
    expect(s.layers).toHaveLength(5);
  });
});

describe("voice transcripts", async () => {
  const { cleanTranscript } = await import("./speech");
  it("ignores empty or ghost transcriptions", () => {
    expect(cleanTranscript("...")).toBe("");
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("Sous-titres réalisés par la communauté d'Amara.org")).toBe("");
    expect(cleanTranscript("(musique)")).toBe("");
  });
  it("keeps real speech", () => {
    expect(cleanTranscript(" Lance Steam. ")).toBe("Lance Steam.");
    expect(cleanTranscript("Ça va ?")).toBe("Ça va ?");
  });
});

describe("simple randomizer", async () => {
  const { randomizeSimple, simplify, COLOR_PRESETS, applyColor } = await import("./simpleLook");
  const sl: SlotDef[] = [...slots, { id: "arms", name: "Arms", multiple: true }, { id: "mouth", name: "Mouth", multiple: false }, { id: "status", name: "Status", multiple: false }, { id: "glasses", name: "Glasses", multiple: true }];
  const lib = [asset("nexus_blob", "body"), asset("galaxy_blob", "body"), asset("floaty_fins", "arms"), asset("blob_eyes", "eyes"), asset("tiny_mouth", "mouth"), asset("status_badges", "status"),
    asset("crown", "headwear"), asset("witch_hat", "headwear"), asset("sunglasses", "glasses"), asset("mine", "wings", { custom: true })];
  const byId = new Map(lib.map((a) => [a.id, a]));
  it("keeps locked parts and never touches the user's own assets", () => {
    let start = applyColor(simplify(defaultLook(), byId, sl), COLOR_PRESETS[2]!);
    start = { ...start, layers: [...start.layers, { ...start.layers[0]!, uid: "h", assetId: "builtin/crown", slot: "headwear" }, { ...start.layers[0]!, uid: "m", assetId: "builtin/mine", slot: "wings" }] };
    let n = 0;
    const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 20; i++) {
      const r = randomizeSimple(start, new Set(["color", "hats"]), lib, byId, sl, rnd);
      expect(r.layers.find((l) => l.slot === "body")!.colors.primary).toBe(COLOR_PRESETS[2]!.body.primary);
      expect(r.layers.filter((l) => l.slot === "headwear").map((l) => l.assetId)).toEqual(["builtin/crown"]);
      expect(r.layers.some((l) => l.assetId === "builtin/mine")).toBe(true);
      expect(["eyes", "mouth", "arms", "status"].every((s) => r.layers.some((l) => l.slot === s))).toBe(true);
    }
  });
});
