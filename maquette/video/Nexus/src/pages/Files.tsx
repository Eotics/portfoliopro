import { ArrowUp, File, Folder, FolderOpen, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Empty, PageHeader, cx, fmtBytes, fmtTime } from "../components/ui";
import { api, errMsg, type FileItem, type Workspace } from "../lib/api";
import { useL, useNexus } from "../lib/store";

export default function FilesPage() {
  const { run, go } = useNexus();
  const L = useL();
  const [ws, setWs] = useState<Workspace[]>([]);
  const [path, setPath] = useState<string | undefined>();
  const [items, setItems] = useState<FileItem[]>([]);
  const [cur, setCur] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listWorkspaces().then((w) => { setWs(w); if (w[0]) setPath(w[0].path); }).catch(() => {}); }, []);
  useEffect(() => {
    if (!path) return;
    api.browseFolder(path).then((r) => { setItems(r.items); setCur(r.path); setErr(null); }).catch((e) => setErr(errMsg(e)));
  }, [path]);

  const root = ws.find((w) => cur.toLowerCase().startsWith(w.path.toLowerCase()));
  const atRoot = root && cur.toLowerCase() === root.path.toLowerCase();
  const parent = cur.replace(/\\[^\\]+$/, "");

  return (
    <div>
      <PageHeader title={L("Fichiers", "Files")} subtitle={L("Ce que NEXUS peut voir : uniquement vos dossiers autorisés.", "What NEXUS can see: only your authorized folders.")}>
        <Button variant="ghost" onClick={() => go("permissions")}>{L("Gérer les dossiers", "Manage folders")}</Button>
      </PageHeader>
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 md:col-span-3" title={L("Dossiers autorisés", "Authorized folders")}>
          <ul className="space-y-1">
            {ws.map((w) => (
              <li key={w.id}>
                <button onClick={() => setPath(w.path)} className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px]", root?.id === w.id ? "bg-white/[0.07]" : "hover:bg-white/[0.035]")}>
                  <FolderOpen className="h-4 w-4 text-sky" /><span className="truncate">{w.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="col-span-12 md:col-span-9" pad={false}>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Button size="sm" variant="ghost" icon={<ArrowUp className="h-3.5 w-3.5" />} disabled={!cur || !!atRoot} onClick={() => setPath(parent)}>{L("Parent", "Up")}</Button>
            <span className="min-w-0 truncate font-mono text-[11.5px] text-mute">{cur}</span>
          </div>
          {err ? <div className="p-4 text-[12.5px] text-bad">{err}</div> : items.length === 0 ? <Empty icon={<Folder className="h-6 w-6" />} title={L("Dossier vide", "Empty folder")} /> : (
            <table className="w-full text-left text-[12.5px]">
              <tbody className="divide-y divide-line">
                {items.map((f) => (
                  <tr key={f.path} className="cursor-default hover:bg-white/[0.025]" onDoubleClick={() => (f.type === "folder" ? setPath(f.path) : run(api.openPath(f.path)))}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {f.type === "folder" ? <Folder className="h-4 w-4 text-sky/80" /> : <File className="h-4 w-4 text-dim" />}
                        <span className="truncate">{f.name}</span>
                        {f.protected && <span title={L("Protégé : NEXUS ne peut pas y toucher", "Protected: NEXUS cannot touch this")}><Lock className="h-3 w-3 text-warn" /></span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[11px] text-mute">{f.type === "file" ? fmtBytes(f.size) : ""}</td>
                    <td className="px-4 py-2 text-right text-[11px] text-dim">{fmtTime(f.modified, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="border-t border-line px-4 py-2 text-[10.5px] text-dim">{L("Double-clic : ouvrir. Demandez à NEXUS dans le Chat de créer, déplacer ou supprimer des fichiers.", "Double-click to open. Ask NEXUS in Chat to create, move or delete files.")}</div>
        </Card>
      </div>
    </div>
  );
}
