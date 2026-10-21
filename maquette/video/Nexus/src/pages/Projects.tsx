import { FolderKanban, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ConfirmButton, Empty, Input, PageHeader, cx, fmtTime } from "../components/ui";
import { api, type MemoryRow, type Project } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

export default function ProjectsPage() {
  const { run } = useNexus();
  const L = useL();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", notes: "" });
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [newMem, setNewMem] = useState("");

  const load = () => api.listProjects().then(setProjects).catch(() => {});
  const loadMem = () => api.listMemory().then(setMemory).catch(() => {});
  useEffect(() => { load(); loadMem(); }, []);
  useEvent("nexus://memory", loadMem);
  const project = projects.find((p) => p.id === sel);
  useEffect(() => {
    if (project) setDraft({ name: project.name, description: project.description, notes: project.notes });
    else if (sel === null) setDraft({ name: "", description: "", notes: "" });
  }, [sel, project]);

  const save = async () => {
    const id = await run(api.saveProject({ id: sel ?? undefined, ...draft }), L("Projet enregistré", "Project saved"));
    if (id) { setSel(id); load(); }
  };
  const projMem = memory.filter((m) => m.projectId === sel);

  return (
    <div>
      <PageHeader title={L("Projets", "Projects")} subtitle={L("Regroupez notes et mémoire par projet ; NEXUS s'en sert comme contexte.", "Group notes and memory per project; NEXUS uses them as context.")}>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setSel(null)}>{L("Nouveau projet", "New project")}</Button>
      </PageHeader>
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 md:col-span-4" pad={false}>
          {projects.length === 0 ? <Empty icon={<FolderKanban className="h-6 w-6" />} title={L("Aucun projet", "No projects")} /> : (
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSel(p.id)} className={cx("w-full px-4 py-3 text-left", p.id === sel ? "bg-white/[0.05]" : "hover:bg-white/[0.025]")}>
                    <div className="text-[13px] font-medium">{p.name}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-mute">{p.description || "—"}</div>
                    <div className="mt-1 text-[10.5px] text-dim">{p.memoryCount} {L("souvenirs", "memories")} · {fmtTime(p.updatedAt, true)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="col-span-12 space-y-4 md:col-span-8">
          <Card title={sel ? L("Projet", "Project") : L("Nouveau projet", "New project")} action={sel && (
            <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} confirmLabel={L("Supprimer ?", "Delete?")} onConfirm={async () => { await run(api.deleteProject(sel)); setSel(null); load(); loadMem(); }}>{L("Supprimer", "Delete")}</ConfirmButton>
          )}>
            <div className="space-y-3">
              <Input placeholder={L("Nom", "Name")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input placeholder={L("Description", "Description")} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <textarea placeholder={L("Notes", "Notes")} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                className="min-h-32 w-full rounded-lg border border-line bg-black/25 px-3 py-2 text-[13px] outline-none focus:border-sky/50" />
              <Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!draft.name.trim()} onClick={save}>{L("Enregistrer", "Save")}</Button>
            </div>
          </Card>
          {sel && (
            <Card title={L("Mémoire du projet", "Project memory")}>
              <form className="mb-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (project && (await run(api.addMemory(newMem, project.name)))) { setNewMem(""); loadMem(); load(); } }}>
                <Input placeholder={L("Fait à retenir pour ce projet…", "Fact to remember for this project…")} value={newMem} onChange={(e) => setNewMem(e.target.value)} />
                <Button type="submit" disabled={!newMem.trim()}>{L("Ajouter", "Add")}</Button>
              </form>
              {projMem.length === 0 ? <Empty title={L("Rien pour l'instant", "Nothing yet")} /> : (
                <ul className="divide-y divide-line">
                  {projMem.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 py-2 text-[13px]">
                      <span className="flex-1">{m.content}</span>
                      <button className="rounded p-1 text-dim hover:text-bad" onClick={async () => { await run(api.deleteMemory(m.id)); loadMem(); load(); }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
