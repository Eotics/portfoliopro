import type { AgentStatus } from "./api";

export type CharState =
  | "IDLE" | "LISTENING" | "THINKING" | "PLANNING" | "EXECUTING"
  | "WAITING_PERMISSION" | "SUCCESS" | "ERROR" | "STOPPED";

/** Backend verdict emitted on `nexus://outcome` at the end of every request. */
export type Outcome = "success" | "warnings" | "answered" | "error" | "stopped";

export interface CharInput {
  status: AgentStatus | undefined;
  stopped: boolean;
  pendingApprovals: number;
  /** Most recent outcome, only while it is still "fresh" (a few seconds). */
  freshOutcome: Outcome | null;
  listening: boolean;
}

/**
 * The character only mirrors real backend state. SUCCESS requires the backend's
 * "success" verdict (every action completed and none unverified); warnings show
 * the concerned face, never the happy one.
 */
export function characterState(i: CharInput): CharState {
  if (i.stopped || i.status === "STOPPED") return "STOPPED";
  if (i.pendingApprovals > 0 || i.status === "WAITING_PERMISSION") return "WAITING_PERMISSION";
  switch (i.status) {
    case "THINKING": return "THINKING";
    case "PLANNING": return "PLANNING";
    case "EXECUTING":
    case "VERIFYING": return "EXECUTING";
    case "ERROR": return "ERROR";
    default: break;
  }
  if (i.freshOutcome === "success") return "SUCCESS";
  if (i.freshOutcome === "warnings" || i.freshOutcome === "error") return "ERROR";
  if (i.listening) return "LISTENING";
  return "IDLE";
}

export const charLabel: Record<CharState, { fr: string; en: string }> = {
  IDLE: { fr: "Prêt", en: "Ready" },
  LISTENING: { fr: "J'écoute…", en: "Listening…" },
  THINKING: { fr: "Je réfléchis…", en: "Thinking…" },
  PLANNING: { fr: "Je prépare le plan…", en: "Planning…" },
  EXECUTING: { fr: "J'agis…", en: "Working…" },
  WAITING_PERMISSION: { fr: "J'ai besoin de votre accord", en: "I need your approval" },
  SUCCESS: { fr: "C'est fait, vérifié", en: "Done and verified" },
  ERROR: { fr: "Quelque chose n'a pas marché", en: "Something went wrong" },
  STOPPED: { fr: "Arrêté", en: "Stopped" },
};

/** Parses a unified diff into display lines (no fabrication: input is the backend's diff). */
export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  text: string;
}
export function parseUnifiedDiff(diff: string): DiffLine[] {
  return diff
    .replace(/\r/g, "")
    .split("\n")
    .filter((l, i, a) => !(l === "" && i === a.length - 1))
    .map((l) => {
      if (l.startsWith("+++") || l.startsWith("---")) return { kind: "meta", text: l };
      if (l.startsWith("@@")) return { kind: "hunk", text: l };
      if (l.startsWith("+")) return { kind: "add", text: l.slice(1) };
      if (l.startsWith("-")) return { kind: "del", text: l.slice(1) };
      return { kind: "ctx", text: l.startsWith(" ") ? l.slice(1) : l };
    });
}

export function diffStats(diff: string) {
  const lines = parseUnifiedDiff(diff);
  return { added: lines.filter((l) => l.kind === "add").length, removed: lines.filter((l) => l.kind === "del").length };
}
