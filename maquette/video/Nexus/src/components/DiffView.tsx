import { diffStats, parseUnifiedDiff } from "../lib/companionState";
import { cx } from "./ui";

/** Renders a unified diff produced by the backend (never synthesised in the UI). */
export function DiffView({ diff, maxHeight = 320 }: { diff: string; maxHeight?: number }) {
  if (!diff.trim()) return <div className="text-[11.5px] text-dim">No change (content identical).</div>;
  const lines = parseUnifiedDiff(diff);
  const st = diffStats(diff);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-black/40">
      <div className="flex items-center gap-3 border-b border-line px-3 py-1.5 font-mono text-[10.5px]">
        <span className="text-ok">+{st.added}</span>
        <span className="text-bad">−{st.removed}</span>
      </div>
      <pre className="overflow-auto py-1 font-mono text-[11px] leading-[1.55]" style={{ maxHeight }}>
        {lines.filter((l) => l.kind !== "meta").map((l, i) => (
          <div key={i} className={cx("px-3 whitespace-pre",
            l.kind === "add" && "bg-ok/10 text-ok",
            l.kind === "del" && "bg-bad/10 text-bad/90",
            l.kind === "hunk" && "bg-sky/[0.06] text-sky/80",
            l.kind === "ctx" && "text-fg/70")}>
            {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : l.kind === "hunk" ? "" : "  "}{l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
