import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Character } from "../components/Character";
import { useRegistry } from "../lib/assets";
import type { CharState } from "../lib/companionState";
import { SIZE_PX, normalizeLook, type CompanionState, type Look } from "../lib/look";
import { studio } from "../lib/studioApi";
import { useEvent } from "../lib/store";

/** The user's current Companion look, kept in sync with the Studio. */
export function useLook(): Look | null {
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => {
    studio.getLook().then((l) => setLook(normalizeLook(l ?? undefined))).catch(() => setLook(normalizeLook(undefined)));
    const un = listen<Look>("nexus://appearance", (e) => setLook(normalizeLook(e.payload)));
    return () => { void un.then((f) => f()); };
  }, []);
  return look;
}

const SEARCH_TOOLS = ["browser.read", "browser.search", "filesystem.search", "filesystem.list", "system.list_installed_applications"];
const SLEEP_AFTER_MS = 15 * 60 * 1000;

/**
 * Derives the extended Companion state from real signals only:
 * SEARCHING = a search/read tool is actually running; SLEEPING = idle with no
 * activity for 15 minutes.
 */
export function useCompanionState(cs: CharState): CompanionState {
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [, tick] = useState(0);
  useEvent<{ tool: string; status: string }>("nexus://tool", (e) => {
    setLastActivity(Date.now());
    setRunningTool(e.status === "RUNNING" ? e.tool : null);
  });
  useEvent("nexus://status", () => setLastActivity(Date.now()));
  useEffect(() => { setLastActivity(Date.now()); }, [cs]);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);
  if (cs === "EXECUTING" && runningTool && SEARCH_TOOLS.includes(runningTool)) return "SEARCHING";
  if (cs === "IDLE" && Date.now() - lastActivity > SLEEP_AFTER_MS) return "SLEEPING";
  return cs;
}

export function CompanionFigure({ state, size, look, motion, accent, title, fixedSize, expression, animation, gaze }: {
  state: CompanionState; size: number; look: Look | null; motion: "full" | "subtle" | "off"; accent: string; title: string; fixedSize?: boolean;
  expression?: string; animation?: string; gaze?: { x: number; y: number };
}) {
  const reg = useRegistry();
  const px = fixedSize ? size : Math.round(size * SIZE_PX[look?.size ?? "m"]);
  if (!reg || !look) {
    const legacy: CharState = state === "SEARCHING" || state === "VERIFYING" ? "EXECUTING" : state === "SLEEPING" ? "IDLE" : state;
    return <Character state={legacy} size={px} accent={accent} motion={motion} title={title} />;
  }
  return <div title={title}><Avatar look={look} assets={reg.byId} slots={reg.slots} state={state} size={px} motion={motion} previewExpression={expression} animation={animation} gaze={gaze} /></div>;
}
