import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api, type ApprovalChoice, type ApprovalRequest } from "../lib/api";
import { useL, useNexus } from "../lib/store";
import { DiffView } from "./DiffView";
import { Button, RiskBadge, cx } from "./ui";

export function ApprovalCard({ req, compact }: { req: ApprovalRequest; compact?: boolean }) {
  const { run } = useNexus();
  const L = useL();
  const [busy, setBusy] = useState(false);
  const answer = async (c: ApprovalChoice) => {
    setBusy(true);
    await run(api.resolveApproval(req.id, c));
    setBusy(false);
  };
  const high = req.risk === "HIGH";
  return (
    <div className={cx("glass fade-up overflow-hidden bg-ink-2/90 shadow-2xl", high ? "border-bad/40" : "border-warn/35")}>
      <div className={cx("flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em]", high ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn")}>
        <ShieldAlert className="h-4 w-4" />
        {L("NEXUS demande l'autorisation", "NEXUS wants to")}
        <span className="ml-auto"><RiskBadge risk={req.risk} /></span>
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="text-[15px] font-medium leading-snug text-fg">{req.summary}</div>
        {req.details.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {req.details.map(([k, v], i) => k === "Diff" ? (
              <div key={i} className="col-span-2 mt-1"><DiffView diff={v} maxHeight={compact ? 160 : 260} /></div>
            ) : (
              <div key={i} className="contents">
                <dt className="text-mute">{k}</dt>
                <dd className="min-w-0 break-words font-mono text-[11.5px] text-fg/90 whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {!compact && (
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-mute">{L("Raison", "Reason")}</span>
            <span className="text-fg/85">{req.reason}</span>
            <span className="text-mute">{L("Permission", "Permission")}</span>
            <span className="font-mono text-[11.5px] text-fg/85">{req.scope} · {req.tool}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="danger" disabled={busy} onClick={() => answer("deny")}>{L("Refuser", "Deny")}</Button>
          <Button variant="ok" disabled={busy} onClick={() => answer("once")}>{L("Autoriser une fois", "Allow once")}</Button>
          {req.allowAlways && (
            <Button variant="subtle" disabled={busy} onClick={() => answer("always")}>{L("Toujours autoriser", "Always allow")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Global dock so approvals are never missed, whatever page is open. */
export function ApprovalDock() {
  const { approvals, page } = useNexus();
  if (approvals.length === 0 || page === "chat") return null;
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex w-[420px] max-w-[calc(100vw-2.5rem)] flex-col gap-3">
      {approvals.map((a) => (
        <div key={a.id} className="pointer-events-auto"><ApprovalCard req={a} /></div>
      ))}
    </div>
  );
}
