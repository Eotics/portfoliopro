import { useId } from "react";
import { cx } from "./ui";
import type { CharState } from "../lib/companionState";

export const ACCENTS: Record<string, string> = {
  sky: "#8fd3ff",
  teal: "#5eead4",
  violet: "#a99bff",
};

const STATE_COLOR: Partial<Record<CharState, string>> = {
  WAITING_PERMISSION: "#f5c451",
  SUCCESS: "#4ade9b",
  ERROR: "#ff8a95",
  STOPPED: "#8d96a8",
};

/** Eyes per state, drawn on a 100×100 face. */
function Eyes({ state, color }: { state: CharState; color: string }) {
  const common = { fill: color };
  switch (state) {
    case "SUCCESS":
      return (
        <g stroke={color} strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M33 56 q7 -9 14 0" /><path d="M55 56 q7 -9 14 0" />
        </g>
      );
    case "ERROR":
      return (
        <g {...common}>
          <rect x="34" y="50" width="12" height="9" rx="4" />
          <rect x="56" y="50" width="12" height="9" rx="4" />
          <g stroke={color} strokeWidth="3.5" strokeLinecap="round">
            <path d="M33 44 l12 4" /><path d="M69 44 l-12 4" />
          </g>
        </g>
      );
    case "STOPPED":
      return (
        <g stroke={color} strokeWidth="5" strokeLinecap="round">
          <path d="M34 55 h12" /><path d="M56 55 h12" />
        </g>
      );
    case "PLANNING":
      return (
        <g {...common}>
          <rect x="33" y="51" width="14" height="6" rx="3" />
          <rect x="55" y="51" width="14" height="6" rx="3" />
        </g>
      );
    case "WAITING_PERMISSION":
      return (
        <g {...common}>
          <circle cx="40" cy="54" r="7.5" /><circle cx="62" cy="54" r="7.5" />
          <circle cx="42" cy="51" r="2.2" fill="#0b0e14" /><circle cx="64" cy="51" r="2.2" fill="#0b0e14" />
        </g>
      );
    case "THINKING":
      return (
        <g className="nx-look" {...common}>
          <rect x="34" y="47" width="11" height="14" rx="5.5" />
          <rect x="56" y="47" width="11" height="14" rx="5.5" />
        </g>
      );
    case "LISTENING":
      return (
        <g {...common}>
          <rect x="33" y="45" width="13" height="17" rx="6.5" />
          <rect x="55" y="45" width="13" height="17" rx="6.5" />
        </g>
      );
    default:
      return (
        <g className="nx-blink" {...common}>
          <rect x="34" y="47" width="12" height="15" rx="6" />
          <rect x="56" y="47" width="12" height="15" rx="6" />
        </g>
      );
  }
}

/**
 * The NEXUS character. Purely presentational: the caller passes the state
 * derived from real backend events (see characterState).
 */
export function Character({ state, size = 96, accent = "sky", motion = "full", title }: {
  state: CharState;
  size?: number;
  accent?: string;
  motion?: "full" | "subtle" | "off";
  title?: string;
}) {
  const eye = STATE_COLOR[state] ?? ACCENTS[accent] ?? ACCENTS.sky!;
  const glow = state === "EXECUTING" || state === "THINKING" || state === "PLANNING";
  const uid = useId().replace(/:/g, "");
  return (
    <div
      className={cx("nx-char relative shrink-0", `nx-${state.toLowerCase()}`, motion === "off" ? "nx-still" : motion === "subtle" ? "nx-subtle" : "")}
      style={{ width: size, height: size, ["--nx-eye" as string]: eye }}
      role="img"
      aria-label={title ?? state}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} className="nx-body overflow-visible">
        <defs>
          <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d9e1ec" />
          </linearGradient>
          <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.55" r="0.6">
            <stop offset="0" stopColor={eye} stopOpacity="0.45" /><stop offset="1" stopColor={eye} stopOpacity="0" />
          </radialGradient>
        </defs>
        {glow && <circle className="nx-aura" cx="50" cy="55" r="48" fill={`url(#${uid}-glow)`} />}
        {/* antenna */}
        <line x1="50" y1="14" x2="50" y2="24" stroke="#cfd8e4" strokeWidth="3" strokeLinecap="round" />
        <circle className="nx-antenna" cx="50" cy="11" r="4.5" fill={eye} />
        {/* ears */}
        <rect x="9" y="44" width="9" height="20" rx="4.5" fill="#c9d3e0" />
        <rect x="82" y="44" width="9" height="20" rx="4.5" fill="#c9d3e0" />
        {/* head */}
        <rect x="16" y="24" width="68" height="60" rx="24" fill={`url(#${uid}-shell)`} />
        {/* face screen */}
        <rect x="24" y="34" width="52" height="40" rx="16" fill="#0b0e14" />
        <Eyes state={state} color={eye} />
        {state === "THINKING" && (
          <g fill={eye} className="nx-dots"><circle cx="40" cy="68" r="1.8" /><circle cx="50" cy="68" r="1.8" /><circle cx="60" cy="68" r="1.8" /></g>
        )}
      </svg>
      {state === "WAITING_PERMISSION" && (
        <span className="nx-badge absolute -top-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-warn text-[11px] font-bold text-ink shadow">!</span>
      )}
    </div>
  );
}
