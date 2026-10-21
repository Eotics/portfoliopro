import { Activity, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, ConfirmButton, Empty, Input, PageHeader, RiskBadge, StatusPill, cx, fmtTime } from "../components/ui";
import { api, type ActivityRow } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

const KINDS = ["all", "agent", "tool", "permission", "manual", "stop", "system"] as const;

export default function ActivityPage() {
  const { run } = useNexus();
  const L = useL();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [q, setQ] = useState("");
  const load = () => api.listActivity(1000, kind === "all" ? undefined : kind).then(setRows).catch(() => {});
  useEffect(() => { load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEvent<ActivityRow>("nexus://activity", (a) => {
    if (kind === "all" || a.kind === kind) setRows((r) => [a, ...r].slice(0, 1000));
  });
  const shown = rows.filter((r) => !q || `${r.action} ${r.tool ?? ""} ${r.error ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const label: Record<string, string> = { all: L("Tout", "All"), agent: "Agent", tool: L("Outils", "Tools"), permission: "Permissions", manual: L("Manuel", "Manual"), stop: "STOP", system: L("Système", "System") };

  return (
    <div>
      <PageHeader title={L("Activité", "Activity")} subtitle={L("Journal d'audit complet de ce que NEXUS et vous avez fait.", "Complete audit log of what NEXUS and you did.")}>
        <Input className="w-56" placeholder={L("Filtrer…", "Filter…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <ConfirmButton variant="ghost" icon={<Trash2 className="h-4 w-4" />} confirmLabel={L("Confirmer l'effacement", "Confirm clear")} onConfirm={async () => { await run(api.clearActivity()); load(); }}>{L("Effacer", "Clear")}</ConfirmButton>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cx("rounded-lg border px-3 py-1.5 text-[12px]", kind === k ? "border-sky/40 bg-sky/10 text-fg" : "border-line text-mute hover:text-fg")}>{label[k]}</button>
        ))}
      </div>
      <Card pad={false}>
        {shown.length === 0 ? <Empty icon={<Activity className="h-6 w-6" />} title={L("Aucun événement", "No events")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[10.5px] uppercase tracking-[0.12em] text-dim">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-semibold">{L("Heure", "Time")}</th>
                  <th className="px-2 py-2.5 font-semibold">{L("Action", "Action")}</th>
                  <th className="px-2 py-2.5 font-semibold">{L("Outil", "Tool")}</th>
                  <th className="px-2 py-2.5 font-semibold">{L("Risque", "Risk")}</th>
                  <th className="px-2 py-2.5 font-semibold">Permission</th>
                  <th className="px-2 py-2.5 font-semibold">{L("Statut", "Status")}</th>
                  <th className="px-4 py-2.5 font-semibold">{L("Résultat / erreur", "Result / error")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r, i) => (
                  <tr key={r.id ?? `live-${i}`} className="align-top hover:bg-white/[0.02]">
                    <td className="px-4 py-2 font-mono text-[11px] whitespace-nowrap text-dim">{fmtTime(r.ts, true)}</td>
                    <td className="max-w-[360px] px-2 py-2 text-fg/90">{r.action}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-mute">{r.tool ?? "—"}</td>
                    <td className="px-2 py-2"><RiskBadge risk={r.risk} /></td>
                    <td className="px-2 py-2 font-mono text-[11px] text-mute">{r.permission ?? "—"}</td>
                    <td className="px-2 py-2"><StatusPill status={r.status} /></td>
                    <td className="max-w-[360px] px-4 py-2 text-[11.5px]">{r.error ? <span className="text-bad/90">{r.error}</span> : <span className="text-mute">{r.result ?? ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
