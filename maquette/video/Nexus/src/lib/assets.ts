// Asset registry + lazy, cached asset data. Assets are always displayed as
// <img> (data URLs): an SVG rendered as an image cannot run scripts or fetch
// anything, on top of the backend sanitiser.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useSyncExternalStore } from "react";
import { applyColors, resolveColors, type AssetDef, type Layer, type SlotDef } from "./look";

export interface Registry {
  assets: AssetDef[];
  slots: SlotDef[];
  packs: { id: string; name: string; version?: string; assets?: number; folder?: string; error?: string; loose?: boolean }[];
  root: string;
  byId: Map<string, AssetDef>;
}

let registry: Registry | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

function setRegistry(r: Omit<Registry, "byId">) {
  registry = { ...r, byId: new Map(r.assets.map((a) => [a.id, a])) };
  notify();
}

export function loadRegistry(force = false) {
  if (loading && !force) return loading;
  loading = invoke<Omit<Registry, "byId">>(force ? "studio_rescan" : "studio_registry").then(setRegistry).catch(() => {}).finally(() => { loading = null; });
  return loading;
}

let listening = false;
export function useRegistry(): Registry | null {
  const r = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => registry);
  useEffect(() => {
    if (!registry) void loadRegistry();
    if (!listening) {
      listening = true;
      void listen("nexus://studio-assets", () => { void loadRegistry(true); });
    }
  }, []);
  return r;
}

// ---------------------------------------------------------------- data cache

type Raw = { kind: "svg" | "raster"; data: string };
const raw = new Map<string, Raw>();
const pending = new Map<string, Promise<Raw>>();

export function clearAssetCache(id?: string) {
  if (!id) { raw.clear(); return; }
  for (const k of [...raw.keys()]) if (k.startsWith(id + "|")) raw.delete(k);
}

export function loadRaw(id: string, variant?: string): Promise<Raw> {
  const key = `${id}|${variant ?? ""}`;
  const hit = raw.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = invoke<Raw>("studio_asset_data", { id, variant: variant ?? null })
      .then((r) => { raw.set(key, r); return r; })
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

const urlCache = new Map<string, string>();
export function svgUrl(svg: string) {
  let u = urlCache.get(svg);
  if (!u) {
    u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    if (urlCache.size > 2000) urlCache.clear();
    urlCache.set(svg, u);
  }
  return u;
}

/** Resolves the image URL for a layer (colours substituted, expression variant chosen). */
export function useLayerImage(layer: Pick<Layer, "assetId" | "colors">, asset: AssetDef | undefined, variant?: string) {
  const v = asset && variant && asset.variants.includes(variant) ? variant : undefined;
  const [r, setR] = useState<{ raw: Raw; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${layer.assetId}|${v ?? ""}`;
  useEffect(() => {
    if (!asset?.supported) { setR(null); return; }
    let alive = true;
    loadRaw(layer.assetId, v).then((x) => alive && setR({ raw: x, key })).catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [key, asset?.supported]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!asset) return { url: null, raster: false, error: "missing" };
  if (!asset.supported) return { url: null, raster: false, error: asset.unsupportedReason ?? "unsupported" };
  if (!r) return { url: null, raster: false, error };
  if (r.raw.kind === "raster") return { url: r.raw.data, raster: true, error: null };
  return { url: svgUrl(applyColors(r.raw.data, resolveColors(layer as Layer, asset))), raster: false, error: null };
}

// ---------------------------------------------------------------- alpha hit-testing

const alpha = new Map<string, Promise<Uint8ClampedArray | null>>();
const RES = 200;

/** Opaque-pixel map of an image rendered into a 200x200 box (cached). */
export function alphaMap(url: string): Promise<Uint8ClampedArray | null> {
  let p = alpha.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = RES; c.height = RES;
          const ctx = c.getContext("2d")!;
          const s = Math.min(RES / img.naturalWidth || 1, RES / img.naturalHeight || 1);
          const w = (img.naturalWidth || RES) * s, h = (img.naturalHeight || RES) * s;
          ctx.drawImage(img, (RES - w) / 2, (RES - h) / 2, w, h);
          resolve(ctx.getImageData(0, 0, RES, RES).data);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    if (alpha.size > 500) alpha.clear();
    alpha.set(url, p);
  }
  return p;
}

export async function isOpaqueAt(url: string, u: number, v: number) {
  const m = await alphaMap(url);
  if (!m) return true;
  const x = Math.floor(u * RES), y = Math.floor(v * RES);
  if (x < 0 || y < 0 || x >= RES || y >= RES) return false;
  return m[(y * RES + x) * 4 + 3]! > 24;
}
