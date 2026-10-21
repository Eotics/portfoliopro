import { Check, ListChecks, MessageSquare, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Empty, PageHeader, RiskBadge, StatusPill, cx, fmtTime } from "../components/ui";
import { api, type TaskDetail, type TaskRow } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

export default function TasksPage() {
  const { pageArg, go, run } = useNexus();
  const L = useL();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [sel, setSel] = useState<string | undefined>(pageArg);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [filter, setFilter] = useState("ALL");

  const load = () => api.listTasks().then(setTasks).catch(() => {});
  useEffect(() => { load(); }, []);
  useEvent("nexus://tasks", load);
  useEvent("nexus://tool", () => { if (sel) api.getTask(sel).then(setDetail).catch(() => {}); });
  useEffect(() => {
    if (!sel && tasks[0]) setSel(tasks[0].id);
  }, [tasks, sel]);
  useEffect(() => { if (sel) api.getTask(sel).then(setDetail).catch(() => setDetail(null)); }, [sel, tasks]);

  const statuses = ["ALL", "RUNNING", "WAITING_PERMISSION", "COMPLETED", "FAILED", "CANCELLED"];
  const shown = tasks.filter((t) => filter === "ALL" || t.status === filter);
  const task = tasks.find((t) => t.id === sel);

  return (
    <div>
      <PageHeader title={L("Tâches", "Tasks")} subtitle={L("Chaque demande qui utilise des outils devient une tâche traçable.", "Every request that uses tools becomes a traceable task.")}>
        <div className="flex flex-wrap rounded-lg border border-line bg-black/25 p-0.5">
          {statuses.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={cx("rounded-md px-2.5 py-1 text-[10.5px] font-semibold tracking-wide", filter === s ? "bg-white/12 text-fg" : "text-mute hover:text-fg")}>
              {s === "ALL" ? L("TOUTES", "ALL") : s.replace("_", " ")}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-5" pad={false}>
          {shown.length === 0 ? <Empty icon={<ListChecks className="h-6 w-6" />} title={L("Aucune tâche", "No tasks")}>{L("Demandez quelque chose à NEXUS dans le Chat.", "Ask NEXUS something in Chat.")}</Empty> : (
            <ul className="divide-y divide-line">
              {shown.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSel(t.id)} className={cx("w-full px-4 py-3 text-left transition-colors", t.id === sel ? "bg-white/[0.05]" : "hover:bg-white/[0.025]")}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.title}</span>
                      <StatusPill status={t.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-dim">
                      <span>{fmtTime(t.createdAt, true)}</span>
                      <span>{t.toolRuns} {L("actions", "actions")}</span>
                      {t.progress > 0 && <span>{Math.round(t.progress * 100)}%</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="col-span-12 space-y-4 lg:col-span-7">
          {task && detail ? (
            <>
              <Card title={L("Demande", "Request")} action={
                <div className="flex gap-1.5">
                  {task.conversationId && <Button size="sm" variant="ghost" icon={<MessageSquare className="h-3.5 w-3.5" />} onClick={() => go("chat", task.conversationId!)}>{L("Conversation", "Conversation")}</Button>}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={["RUNNING", "WAITING_PERMISSION"].includes(task.status)}
                    onClick={async () => { await run(api.deleteTask(task.id)); setSel(undefined); load(); }}>{L("Supprimer", "Delete")}</Button>
                </div>
              }>
                <div className="text-[14px] leading-relaxed">{task.description}</div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-dim">
                  <StatusPill status={task.status} /><span>{L("Créée", "Created")} {fmtTime(task.createdAt, true)}</span><span>{L("Mise à jour", "Updated")} {fmtTime(task.updatedAt, true)}</span><span>{L("Priorité", "Priority")} {task.priority}</span>
                </div>
                {task.progress > 0 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-sky to-violet" style={{ width: `${task.progress * 100}%` }} /></div>
                )}
              </Card>
              {detail.steps.length > 0 && (
                <Card title={L("Plan", "Plan")}>
                  <ol className="space-y-1.5">
                    {detail.steps.map((s) => (
                      <li key={s.idx} className="flex items-center gap-2 text-[13px]">
                        <span className={cx("grid h-5 w-5 place-items-center rounded-full border text-[10px] font-bold", s.status === "COMPLETED" ? "border-ok/50 bg-ok/15 text-ok" : s.status === "RUNNING" ? "border-sky/50 text-sky" : "border-line text-dim")}>
                          {s.status === "COMPLETED" ? <Check className="h-3 w-3" /> : s.idx + 1}
                        </span>
                        <span className="flex-1">{s.title}</span><StatusPill status={s.status} />
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
              <Card title={L("Exécution", "Execution")} pad={false}>
                {detail.toolRuns.length === 0 ? <Empty title={L("Aucune action", "No actions")} /> : (
                  <ul className="divide-y divide-line">
                    {[...detail.toolRuns].reverse().map((r) => (
                      <li key={r.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-2 text-[12.5px]">
                          <span className="font-mono text-[10.5px] text-dim">{fmtTime(r.startedAt)}</span>
                          <span className="min-w-0 flex-1 truncate">{(r.result as { summary?: string } | null)?.summary ?? r.summary ?? r.tool}</span>
                          <RiskBadge risk={r.risk} />
                          {r.verified === true && <span className="text-[10.5px] text-ok">✓ {L("vérifié", "verified")}</span>}
                          {r.verified === false && <span className="text-[10.5px] text-warn">{L("non vérifié", "unverified")}</span>}
                          <StatusPill status={r.status} />
                        </div>
                        <div className="mt-0.5 flex gap-3 font-mono text-[10.5px] text-dim">
                          <span>{r.tool}</span><span>{r.permission}</span>{r.decision && <span>{r.decision}</span>}{r.durationMs != null && <span>{r.durationMs} ms</span>}
                        </div>
                        {r.error && <div className="mt-1 text-[11.5px] text-bad/90">{r.error}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : <Card><Empty title={L("Sélectionnez une tâche", "Select a task")} /></Card>}
        </div>
      </div>
    </div>
  );
}
