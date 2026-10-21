import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, FolderPlus, History, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Empty, Input, Modal, PageHeader, RiskBadge, StatusPill, cx, fmtTime } from "../components/ui";
import { api, type AppRow, type AppStatus, type PermissionRow, type ScopeStatus, type ToolRun, type Workspace } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; tone?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-black/25 p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={cx("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", value === o.v ? cx("bg-white/12", o.tone ?? "text-fg") : "text-mute hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function PermissionsPage() {
  const { run } = useNexus();
  const L = useL();
  const [perms, setPerms] = useState<PermissionRow[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [ws, setWs] = useState<Workspace[]>([]);
  const [appQ, setAppQ] = useState("");
  const [appFilter, setAppFilter] = useState<"all" | AppStatus>("all");
  const [history, setHistory] = useState<{ scope: string; runs: ToolRun[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualPath, setManualPath] = useState("");

  const load = () => {
    api.listPermissions().then(setPerms).catch(() => {});
    api.listApps().then(setApps).catch(() => {});
    api.listWorkspaces().then(setWs).catch(() => {});
  };
  useEffect(load, []);
  useEvent("nexus://apps", () => api.listApps().then(setApps).catch(() => {}));

  const setScope = async (scope: string, status: ScopeStatus) => { await run(api.setPermission(scope, status)); load(); };
  const setApp = async (id: string, status: AppStatus) => { await run(api.setAppStatus(id, status)); };
  const addFolder = async (path?: string) => {
    let p = path;
    if (!p) {
      const picked = await openDialog({ directory: true, multiple: false, title: L("Choisir un dossier autorisé", "Choose an authorized folder") });
      if (typeof picked !== "string") return;
      p = picked;
    }
    await run(api.addWorkspace(p), L("Dossier autorisé", "Folder authorized"));
    setManualPath("");
    load();
  };

  const shownApps = apps.filter((a) => (appFilter === "all" || a.status === appFilter) && a.name.toLowerCase().includes(appQ.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader title="Permissions" subtitle={L("Vous décidez de ce que NEXUS peut faire. La politique est appliquée par le backend, pas par l'IA.", "You decide what NEXUS may do. Policy is enforced by the backend, not by the AI.")} />

      <Card title={L("Portées", "Scopes")} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-[0.12em] text-dim">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-semibold">Permission</th>
                <th className="px-2 py-2.5 font-semibold">{L("Risque", "Risk")}</th>
                <th className="px-2 py-2.5 font-semibold">{L("Statut", "Status")}</th>
                <th className="px-2 py-2.5 font-semibold">{L("Dernière utilisation", "Last used")}</th>
                <th className="px-4 py-2.5 font-semibold text-right">{L("Historique", "History")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perms.map((p) => (
                <tr key={p.scope} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[12px] text-fg">{p.scope}</div>
                    <div className="text-[11.5px] text-mute">{p.description}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-dim">{p.tools.join(" · ")}</div>
                  </td>
                  <td className="px-2 py-2.5"><RiskBadge risk={p.risk} /></td>
                  <td className="px-2 py-2.5">
                    <Seg value={p.status} onChange={(v) => setScope(p.scope, v)} options={[
                      { v: "default", label: L("Selon le risque", "By risk") },
                      { v: "always", label: L("Toujours", "Always"), tone: "text-ok" },
                      { v: "deny", label: L("Refuser", "Deny"), tone: "text-bad" },
                    ]} />
                    {p.status !== "default" && <button className="ml-2 text-[11px] text-dim hover:text-fg" onClick={() => setScope(p.scope, "default")}>{L("Révoquer", "Revoke")}</button>}
                  </td>
                  <td className="px-2 py-2.5 text-[11.5px] text-mute">{p.lastUsed ? `${fmtTime(p.lastUsed, true)} · ${p.useCount}×` : "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" />} onClick={async () => setHistory({ scope: p.scope, runs: (await api.permissionHistory(p.scope).catch(() => [])) })}>{L("Voir", "View")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-dim">
          {L("« Selon le risque » : LOW s'exécute automatiquement, MEDIUM et HIGH demandent votre accord (réglable dans Paramètres). Le mode CO-PILOT, les chemins hors dossiers autorisés et les actions sensibles après lecture de contenu non fiable demandent toujours confirmation.",
             "\"By risk\": LOW runs automatically, MEDIUM and HIGH ask for approval (configurable in Settings). CO-PILOT mode, paths outside authorized folders and sensitive actions after reading untrusted content always ask.")}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 xl:col-span-7" title={L(`Applications (${apps.length})`, `Applications (${apps.length})`)} action={
          <Button size="sm" icon={<RefreshCw className={cx("h-3.5 w-3.5", scanning && "animate-spin")} />} disabled={scanning}
            onClick={async () => { setScanning(true); const r = await run(api.rescanApps()); setScanning(false); if (r) load(); }}>{L("Rescanner", "Rescan")}</Button>
        }>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder={L("Rechercher…", "Search…")} value={appQ} onChange={(e) => setAppQ(e.target.value)} />
            <Seg value={appFilter} onChange={setAppFilter} options={[
              { v: "all", label: L("Toutes", "All") }, { v: "ask", label: L("Demander", "Ask") },
              { v: "allowed", label: L("Autorisées", "Allowed"), tone: "text-ok" }, { v: "blocked", label: L("Bloquées", "Blocked"), tone: "text-bad" },
            ]} />
          </div>
          <div className="max-h-[480px] overflow-y-auto rounded-lg border border-line">
            {shownApps.length === 0 ? <Empty icon={<AppWindow className="h-6 w-6" />} title={L("Aucune application", "No applications")} /> : (
              <table className="w-full text-left text-[12px]">
                <tbody className="divide-y divide-line">
                  {shownApps.map((a) => (
                    <tr key={a.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.name}</span>
                          {a.running && <span className="rounded bg-ok/15 px-1.5 text-[9.5px] font-semibold text-ok">{L("OUVERT", "RUNNING")}</span>}
                        </div>
                        <div className="max-w-[420px] truncate font-mono text-[10px] text-dim" title={a.exePath ?? a.launchTarget}>{a.exePath ?? a.launchTarget}</div>
                      </td>
                      <td className="px-2 py-2 text-[10.5px] text-mute">{a.source}</td>
                      <td className="px-3 py-2 text-right">
                        <Seg value={a.status} onChange={(v) => setApp(a.id, v)} options={[
                          { v: "ask", label: L("Demander", "Ask") }, { v: "allowed", label: L("Autoriser", "Allow"), tone: "text-ok" }, { v: "blocked", label: L("Bloquer", "Block"), tone: "text-bad" },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card className="col-span-12 xl:col-span-5" title={L("Dossiers autorisés", "Authorized folders")} action={<Button size="sm" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => addFolder()}>{L("Ajouter", "Add")}</Button>}>
          <ul className="space-y-2">
            {ws.map((w) => (
              <li key={w.id} className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2">
                <ShieldCheck className={cx("h-4 w-4", w.exists ? "text-ok" : "text-bad")} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{w.label}</div>
                  <div className="truncate font-mono text-[10.5px] text-dim">{w.path}</div>
                </div>
                <button className="rounded p-1 text-dim hover:text-bad" title={L("Retirer", "Remove")} onClick={async () => { await run(api.removeWorkspace(w.id)); load(); }}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
            {ws.length === 0 && <Empty title={L("Aucun dossier", "No folders")} />}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manualPath.trim()) void addFolder(manualPath.trim()); }}>
            <Input placeholder="C:\Users\…\Projects" value={manualPath} onChange={(e) => setManualPath(e.target.value)} />
            <Button type="submit" disabled={!manualPath.trim()}>{L("Ajouter", "Add")}</Button>
          </form>
          <p className="mt-3 text-[11px] leading-relaxed text-dim">
            {L("Hors de ces dossiers, chaque accès demande une confirmation. Les dossiers système, les magasins d'identifiants et la base de NEXUS sont toujours interdits. La suppression envoie à la Corbeille.",
               "Outside these folders every access asks for confirmation. System folders, credential stores and NEXUS's own database are always off-limits. Deletion sends to the Recycle Bin.")}
          </p>
        </Card>
      </div>

      <Modal open={!!history} onClose={() => setHistory(null)} title={`${L("Historique", "History")} · ${history?.scope ?? ""}`} wide>
        {history && history.runs.length === 0 && <Empty title={L("Jamais utilisée", "Never used")} />}
        <ul className="divide-y divide-line">
          {history?.runs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-[12.5px]">
              <span className="w-28 shrink-0 font-mono text-[10.5px] text-dim">{fmtTime(r.startedAt, true)}</span>
              <span className="min-w-0 flex-1 truncate">{(r.result as { summary?: string } | null)?.summary ?? r.summary ?? r.tool}</span>
              <span className="font-mono text-[10.5px] text-dim">{r.decision}</span>
              <StatusPill status={r.status} />
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
