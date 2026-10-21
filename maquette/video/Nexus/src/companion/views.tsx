import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AlertTriangle, Archive, Check, ChevronRight, Code2, Copy, ExternalLink, FileCode, FileImage, FileText, FlaskConical,
  FolderPlus, Loader2, Mail, Paperclip, Play, Plug, RefreshCw, Save, Send, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "../components/Approval";
import { DiffView } from "../components/DiffView";
import { Markdown } from "../components/Markdown";
import { Button, ConfirmButton, Empty, Input, Select, StatusPill, cx, fmtBytes, fmtTime } from "../components/ui";
import { PlanCard, ToolCard } from "../pages/Chat";
import { api, errMsg, type InboxFile, type Integration, type Project, type TaskDetail, type TaskRow, type ToolRun, type Workspace } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";
import type { useConversation } from "./useConversation";

type Conv = ReturnType<typeof useConversation>;

// ---------------------------------------------------------------- Assistant

export function MiniThread({ conv, limit }: { conv: Conv; limit?: number }) {
  const L = useL();
  const { state } = useNexus();
  const items = conv.messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === "assistant" || m.content.some((b) => b.type === "text" && !String((b as { text?: string }).text ?? "").startsWith("<context>")));
  const shown = limit ? items.slice(-limit) : items;
  const storedIds = new Set(conv.messages.flatMap((m) => m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id)));
  const liveTools = Object.values(conv.tools).filter((t) => !storedIds.has(t.id));
  return (
    <div className="space-y-2.5">
      {shown.map(({ m, i }) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-sky/[0.1] px-3 py-1.5 text-[12.5px] whitespace-pre-wrap">
              {m.content.filter((b) => b.type === "text" && !String((b as { text?: string }).text).startsWith("<context>")).map((b) => (b as { text: string }).text).join("\n")}
            </div>
          </div>
        ) : (
          <div key={i} className="text-[12.5px]">
            {m.content.map((b, bi) => {
              if (b.type === "text") return <Markdown key={bi} text={(b as { text: string }).text} />;
              if (b.type === "tool_use") {
                const tb = b as { id: string; name: string; input: unknown };
                if (tb.name === "nexus_set_plan") return <PlanCard key={bi} input={tb.input as { steps?: string[] }} />;
                const t = conv.tools[tb.id] ?? { id: tb.id, tool: tb.name.replace("_", "."), status: "REQUESTED", input: tb.input };
                return <ToolCard key={bi} t={{ ...t, input: t.input ?? tb.input }} />;
              }
              return null;
            })}
          </div>
        ),
      )}
      {conv.pending && !conv.messages.some((m) => m.role === "user" && m.content.some((b) => (b as { text?: string }).text === conv.pending)) && (
        <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-sky/[0.1] px-3 py-1.5 text-[12.5px]">{conv.pending}</div></div>
      )}
      {(conv.live || liveTools.length > 0) && (
        <div className="text-[12.5px]">{conv.live && <Markdown text={conv.live} />}{liveTools.map((t) => <ToolCard key={t.id} t={t} />)}</div>
      )}
      {state?.agentRunning && !conv.live && liveTools.length === 0 && conv.pending && (
        <div className="flex items-center gap-2 text-[12px] text-mute"><Loader2 className="h-3.5 w-3.5 animate-spin text-sky" />{L("NEXUS réfléchit…", "NEXUS is thinking…")}</div>
      )}
      {conv.error && <div className="rounded-lg border border-bad/30 bg-bad/[0.07] px-3 py-2 text-[12px] text-bad whitespace-pre-wrap">{conv.error}</div>}
    </div>
  );
}

export function Composer({ conv, placeholder, autoFocus, onFocusChange, inputRef }: {
  conv: Conv; placeholder?: string; autoFocus?: boolean; onFocusChange?: (f: boolean) => void; inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { state } = useNexus();
  const L = useL();
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim() || state?.agentRunning) return;
    const t = text;
    setText("");
    if (!(await conv.send(t))) setText(t);
  };
  return (
    <div className="flex items-end gap-2 rounded-xl border border-line bg-black/35 px-2.5 py-1.5 focus-within:border-sky/40">
      <textarea
        ref={inputRef}
        autoFocus={autoFocus}
        value={text}
        rows={1}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        placeholder={placeholder ?? L("Demandez à NEXUS…", "Ask NEXUS…")}
        className="max-h-28 min-h-[22px] flex-1 resize-none bg-transparent py-1 text-[12.5px] outline-none placeholder:text-dim"
        aria-label={L("Message pour NEXUS", "Message to NEXUS")}
      />
      <Button variant="primary" size="sm" className="h-7 w-7 !px-0" disabled={!text.trim() || !!state?.agentRunning} onClick={() => void send()} aria-label="Send">
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function AssistantView({ conv, voiceSlot }: { conv: Conv; voiceSlot?: React.ReactNode }) {
  const L = useL();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [conv.messages, conv.live, conv.tools]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Assistant", "Assistant")}</span>
        <Button size="sm" variant="ghost" onClick={conv.reset}>{L("Nouvelle conversation", "New conversation")}</Button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {conv.messages.length === 0 && !conv.pending
          ? <Empty title={L("Demandez une action réelle", "Ask for a real action")}>{L("« Ouvre Opera GX », « Explique cette erreur », « Analyse ces fichiers », « Corrige les tests qui échouent »…", "\"Open Opera GX\", \"Explain this error\", \"Analyze these files\", \"Fix the failing tests\"…")}</Empty>
          : <MiniThread conv={conv} />}
      </div>
      <div className="flex items-end gap-2 border-t border-line p-3">{voiceSlot}<div className="min-w-0 flex-1"><Composer conv={conv} autoFocus /></div></div>
    </div>
  );
}

// ---------------------------------------------------------------- Files

const catIcon = { pdf: FileText, image: FileImage, document: FileText, archive: Archive, text: FileText, data: FileCode, code: FileCode, unsupported: AlertTriangle };

export function FilesView({ conv, onAsk }: { conv: Conv; onAsk: () => void }) {
  const { run, toast } = useNexus();
  const L = useL();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<{ name: string; error: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ name: string; text: string; kind: string; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sent, setSent] = useState<Record<string, string>>({});

  const load = () => api.listInbox().then(setFiles).catch((e) => toast(errMsg(e), "error"));
  useEffect(() => { void load(); api.listProjects().then(setProjects).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEvent("nexus://inbox", () => void load());

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    const r = await run(api.importFiles(paths));
    if (!r) return;
    const bad = r.filter((x): x is { ok: false; name: string; error: string } => !x.ok);
    setRejected(bad);
    const ok = r.length - bad.length;
    if (ok) toast(L(`${ok} fichier(s) ajouté(s)`, `${ok} file(s) added`), "ok");
    void load();
  };

  // Native file drops (real paths) from the Tauri webview.
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (p.type === "enter" || p.type === "over") setOver(true);
      else if (p.type === "leave") setOver(false);
      else if (p.type === "drop") { setOver(false); void importPaths(p.paths); }
    }).then((u) => { if (dead) u(); else un = u; });
    return () => { dead = true; un?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => {
    const r = await openDialog({ multiple: true, title: L("Ajouter des fichiers", "Add files") });
    if (Array.isArray(r)) void importPaths(r);
    else if (typeof r === "string") void importPaths([r]);
  };

  const ask = async (f: InboxFile[], verb: string) => {
    const list = f.map((x) => `"${x.path}"`).join(", ");
    const prompts: Record<string, string> = {
      summarize: L(`Résume ${f.length > 1 ? "ces fichiers" : "ce fichier"} : ${list}`, `Summarize ${f.length > 1 ? "these files" : "this file"}: ${list}`),
      analyze: L(`Analyse en détail ${f.length > 1 ? "ces fichiers" : "ce fichier"} et donne les points importants : ${list}`, `Analyze ${f.length > 1 ? "these files" : "this file"} in detail and list the key points: ${list}`),
      explain: L(`Explique ce code : ${list}`, `Explain this code: ${list}`),
      compare: L(`Compare ces documents et liste les différences importantes : ${list}`, `Compare these documents and list the important differences: ${list}`),
    };
    if (await conv.send(prompts[verb]!)) {
      setSent((s) => ({ ...s, ...Object.fromEntries(f.map((x) => [x.path, verb])) }));
      onAsk();
    }
  };

  const extract = async (f: InboxFile) => {
    setBusy(f.path);
    const r = await run(api.extractFileText(f.path));
    setBusy(null);
    if (r) setPreview({ name: f.name, text: r.text, kind: r.kind, truncated: r.truncated });
  };

  const chosen = files.filter((f) => sel.has(f.path));

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <button onClick={pick} className={cx("drop-zone grid min-h-[120px] place-items-center rounded-2xl px-4 py-6 text-center", over && "over")}>
        <div>
          <Upload className={cx("mx-auto h-6 w-6", over ? "text-[#5eead4]" : "text-dim")} />
          <div className="mt-2 text-[13px] font-medium">{L("Déposez vos fichiers ici", "Drop your files here")}</div>
          <div className="mt-1 text-[11px] text-dim">PDF · DOCX · {L("images", "images")} · {L("texte", "text")} · {L("code", "code")} · ZIP — {L("ou cliquez pour choisir", "or click to browse")}</div>
          <div className="mt-1 text-[10.5px] text-dim">{L("Les fichiers sont copiés dans votre Inbox NEXUS. Rien n'est jamais exécuté.", "Files are copied to your NEXUS Inbox. Nothing is ever executed.")}</div>
        </div>
      </button>

      {rejected.length > 0 && (
        <div className="rounded-xl border border-bad/30 bg-bad/[0.06] p-3 text-[12px]">
          <div className="mb-1 flex items-center justify-between font-semibold text-bad">{L("Refusés", "Rejected")}<button onClick={() => setRejected([])} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button></div>
          {rejected.map((r, i) => <div key={i} className="text-fg/80"><span className="font-medium">{r.name}</span> — {r.error}</div>)}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky/25 bg-sky/[0.05] px-3 py-2 text-[12px]">
          <span className="text-mute">{chosen.length} {L("sélectionné(s)", "selected")}</span>
          <Button size="sm" onClick={() => ask(chosen, "summarize")}>{L("Résumer", "Summarize")}</Button>
          <Button size="sm" onClick={() => ask(chosen, "analyze")}>{L("Analyser", "Analyze")}</Button>
          {chosen.length >= 2 && <Button size="sm" onClick={() => ask(chosen, "compare")}>{L("Comparer", "Compare")}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>{L("Désélectionner", "Clear")}</Button>
        </div>
      )}

      {files.length === 0 ? <Empty title={L("Inbox vide", "Inbox is empty")} /> : (
        <ul className="space-y-1.5">
          {files.map((f) => {
            const Icon = catIcon[f.category] ?? FileText;
            return (
              <li key={f.path} className="rounded-xl border border-line bg-black/20 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <input type="checkbox" checked={sel.has(f.path)} aria-label={f.name}
                    onChange={() => setSel((s) => { const n = new Set(s); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })} />
                  <Icon className="h-4 w-4 shrink-0 text-sky/80" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{f.name}</div>
                    <div className="text-[10.5px] text-dim">{f.category} · {fmtBytes(f.size)} · {fmtTime(f.added, true)}
                      {sent[f.path] && <span className="ml-1 text-sky">· {L("envoyé à NEXUS", "sent to NEXUS")}</span>}</div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-ok"><Check className="h-3 w-3" />{L("copié", "copied")}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {f.category !== "unsupported" && f.category !== "image" && <Button size="sm" variant="ghost" onClick={() => ask([f], "summarize")}>{L("Résumer", "Summarize")}</Button>}
                  {f.category !== "unsupported" && <Button size="sm" variant="ghost" onClick={() => ask([f], "analyze")}>{L("Analyser", "Analyze")}</Button>}
                  {f.category === "code" && <Button size="sm" variant="ghost" onClick={() => ask([f], "explain")}>{L("Expliquer le code", "Explain code")}</Button>}
                  {!["image", "unsupported"].includes(f.category) && (
                    <Button size="sm" variant="ghost" disabled={busy === f.path} onClick={() => extract(f)}>
                      {busy === f.path ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{f.category === "archive" ? L("Lister le contenu", "List contents") : L("Extraire le texte", "Extract text")}
                    </Button>
                  )}
                  {projects.length > 0 && (
                    <Select className="h-7 text-[11px]" value="" aria-label={L("Ajouter à un projet", "Add to a project")}
                      onChange={async (e) => { if (e.target.value) await run(api.addFileToProject(e.target.value, f.path), L("Ajouté au projet", "Added to project")); }}>
                      <option value="">{L("Ajouter à un projet…", "Add to project…")}</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  )}
                  <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="h-3 w-3" />} confirmLabel={L("Confirmer", "Confirm")}
                    onConfirm={() => run(api.removeInboxFile(f.path)).then(() => load())}>{L("Retirer", "Remove")}</ConfirmButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <div className="rounded-xl border border-line bg-black/30">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px]">
            <span className="font-medium">{preview.name} <span className="text-dim">· {preview.kind}{preview.truncated ? " · tronqué" : ""}</span></span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Copy className="h-3 w-3" />} onClick={() => navigator.clipboard.writeText(preview.text).then(() => toast(L("Copié", "Copied"), "ok"))}>{L("Copier", "Copy")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)} aria-label="Close"><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] whitespace-pre-wrap text-fg/85">{preview.text}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Task results

function TaskCard({ t }: { t: TaskRow }) {
  const L = useL();
  const [d, setD] = useState<TaskDetail | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { api.getTask(t.id).then(setD).catch(() => {}); }, [t.id, t.updatedAt, t.status]);
  const runs = d?.toolRuns ?? [];
  const modified = runs.filter((r) => ["filesystem.write", "filesystem.edit", "filesystem.rename", "filesystem.move", "filesystem.copy", "filesystem.delete", "filesystem.create_folder"].includes(r.tool) && ["COMPLETED", "UNVERIFIED"].includes(r.status));
  const tests = runs.filter((r) => r.tool === "code.run_tests" && r.status !== "DENIED");
  const errors = runs.filter((r) => ["FAILED", "DENIED", "CANCELLED"].includes(r.status) || r.verified === false);
  const integrations = [...new Set(runs.map((r) => r.tool.split(".")[0]))].filter(Boolean);
  const pathOf = (r: ToolRun) => String((r.input as Record<string, unknown>)?.path ?? (r.input as Record<string, unknown>)?.to ?? "");
  const outcomeLabel: Record<string, string> = { success: L("vérifié", "verified"), warnings: L("avec avertissements", "with warnings"), answered: L("réponse", "answered"), error: L("erreur", "error"), stopped: L("arrêté", "stopped") };
  return (
    <div className="rounded-xl border border-line bg-black/20">
      <button className="w-full px-3 py-2.5 text-left" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          <ChevronRight className={cx("h-3.5 w-3.5 text-dim transition-transform", open && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{t.title}</span>
          {t.outcome && <span className={cx("text-[10px]", t.outcome === "success" ? "text-ok" : t.outcome === "warnings" || t.outcome === "error" ? "text-warn" : "text-dim")}>{outcomeLabel[t.outcome] ?? t.outcome}</span>}
          <StatusPill status={t.status} />
        </div>
        <div className="mt-1.5 flex items-center gap-3 pl-5 text-[10.5px] text-dim">
          <span>{fmtTime(t.updatedAt, true)}</span>
          <span>{modified.length} {L("fichier(s) modifié(s)", "file(s) modified")}</span>
          <span>{tests.length ? `${tests.length} ${L("exécution(s) de tests", "test run(s)")}` : L("aucun test exécuté", "no tests executed")}</span>
          {errors.length > 0 && <span className="text-warn">{errors.length} {L("problème(s)", "issue(s)")}</span>}
        </div>
        {t.progress > 0 && <div className="mt-2 ml-5 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full bg-gradient-to-r from-sky to-violet" style={{ width: `${t.progress * 100}%` }} /></div>}
      </button>
      {open && d && (
        <div className="space-y-2 border-t border-line px-3 py-2.5 text-[11.5px]">
          {integrations.length > 0 && <div className="text-dim">{L("Outils utilisés", "Tools used")}: <span className="font-mono text-mute">{integrations.join(" · ")}</span></div>}
          {modified.map((r) => <div key={r.id} className="truncate font-mono text-fg/80">✎ {pathOf(r)}</div>)}
          {tests.map((r) => {
            const res = r.result as { passed?: boolean; exitCode?: number; runner?: string } | null;
            return <div key={r.id} className={res?.passed ? "text-ok" : "text-bad"}>{res?.runner ?? "tests"}: {r.status === "COMPLETED" ? (res?.passed ? L("réussis", "passed") : `${L("échec", "failed")} (exit ${res?.exitCode ?? "?"})`) : r.status}</div>;
          })}
          {errors.map((r) => <div key={r.id} className="text-bad/90">{r.tool}: {r.error ?? L("non vérifié", "unverified")}</div>)}
          {runs.length === 0 && <div className="text-dim">{L("Aucune action exécutée.", "No action executed.")}</div>}
        </div>
      )}
    </div>
  );
}

export function TasksView() {
  const L = useL();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const load = () => api.listTasks().then((t) => setTasks(t.slice(0, 25))).catch(() => {});
  useEffect(() => { void load(); }, []);
  useEvent("nexus://tasks", () => void load());
  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {tasks.length === 0 ? <Empty title={L("Aucune tâche", "No tasks yet")} /> : tasks.map((t) => <TaskCard key={t.id} t={t} />)}
    </div>
  );
}

// ---------------------------------------------------------------- Coding workspace

const PROJECT_KEY = "nexus.companion.project";

export function CodeView({ conv, onAsk }: { conv: Conv; onAsk: () => void }) {
  const { approvals, run, toast } = useNexus();
  const L = useL();
  const [ws, setWs] = useState<Workspace[]>([]);
  const [project, setProject] = useState<string>(() => { try { return localStorage.getItem(PROJECT_KEY) ?? ""; } catch { return ""; } });
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [openOut, setOpenOut] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = () => api.listToolRuns(600).then(setRuns).catch(() => {});
  useEffect(() => { api.listWorkspaces().then(setWs).catch(() => {}); void load(); }, []);
  useEvent("nexus://tool", () => void load());
  useEffect(() => { try { if (project) localStorage.setItem(PROJECT_KEY, project); } catch { /* optional */ } }, [project]);

  const under = (p: string) => !!project && p.toLowerCase().startsWith(project.toLowerCase());
  const pathOf = (r: ToolRun) => String((r.input as Record<string, unknown>)?.path ?? "");
  const resultPath = (r: ToolRun) => String((r.result as Record<string, unknown> | null)?.path ?? (r.result as Record<string, unknown> | null)?.cwd ?? pathOf(r));
  const changes = runs.filter((r) => ["filesystem.edit", "filesystem.write"].includes(r.tool) && r.status !== "VALIDATING" && under(resultPath(r)));
  const tests = runs.filter((r) => r.tool === "code.run_tests" && under(resultPath(r)));
  const errors = runs.filter((r) => under(resultPath(r)) && ["FAILED", "DENIED", "CANCELLED"].includes(r.status));
  const proposed = approvals.filter((a) => ["filesystem.edit", "filesystem.write", "code.run_tests"].includes(a.tool));

  const pickFolder = async () => {
    const r = await openDialog({ directory: true, title: L("Dossier du projet", "Project folder") });
    if (typeof r === "string") setProject(r);
  };
  const runTests = async () => {
    setTesting(true);
    const r = await run(api.invokeTool("code.run_tests", { path: project }));
    setTesting(false);
    if (r?.isError) toast(r.text, "error");
    void load();
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={project} onChange={(e) => setProject(e.target.value)} className="min-w-0 flex-1" aria-label={L("Projet", "Project")}>
          <option value="">{L("Choisir le projet…", "Choose the project…")}</option>
          {ws.map((w) => <option key={w.id} value={w.path}>{w.label} — {w.path}</option>)}
          {project && !ws.some((w) => w.path === project) && <option value={project}>{project}</option>}
        </Select>
        <Button size="sm" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={pickFolder}>{L("Sous-dossier…", "Subfolder…")}</Button>
        <Button size="sm" variant="primary" icon={testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} disabled={!project || testing} onClick={runTests}>{L("Lancer les tests", "Run tests")}</Button>
        <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={!project}
          onClick={async () => { if (await conv.send(L(`Dans le projet "${project}", lance les tests, analyse les échecs et propose des corrections précises.`, `In the project "${project}", run the tests, analyze failures and propose precise fixes.`))) onAsk(); }}>
          {L("Corriger les tests", "Fix failing tests")}
        </Button>
      </div>
      {!project && <Empty icon={<Code2 className="h-6 w-6" />} title={L("Choisissez un dossier de projet", "Choose a project folder")}>{L("Il doit se trouver dans un dossier autorisé.", "It must be inside an authorized folder.")}</Empty>}

      {project && (
        <>
          {proposed.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-warn">{L("Modifications proposées — à valider", "Proposed changes — review")}</h4>
              <div className="space-y-2">{proposed.map((a) => <ApprovalCard key={a.id} req={a} compact />)}</div>
            </section>
          )}

          <section>
            <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Fichiers modifiés", "Changed files")}</h4>
            {changes.length === 0 ? <div className="text-[12px] text-dim">{L("Aucune modification réelle dans ce projet.", "No real change in this project.")}</div> : (
              <ul className="space-y-1.5">
                {changes.map((r) => {
                  const diff = (r.result as { diff?: string | null } | null)?.diff;
                  return (
                    <li key={r.id} className="rounded-lg border border-line bg-black/20">
                      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]" onClick={() => setOpenDiff(openDiff === r.id ? null : r.id)}>
                        <ChevronRight className={cx("h-3.5 w-3.5 text-dim transition-transform", openDiff === r.id && "rotate-90")} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{resultPath(r).slice(project.length).replace(/^\\/, "") || resultPath(r)}</span>
                        <span className="text-[10.5px] text-dim">{fmtTime(r.startedAt, true)}</span>
                        <StatusPill status={r.status} />
                      </button>
                      {openDiff === r.id && <div className="px-3 pb-3">
                        {r.error ? <div className="text-[11.5px] text-bad">{r.error}</div> : diff ? <DiffView diff={diff} /> : <div className="text-[11.5px] text-dim">{L("Pas de diff enregistré pour cette action.", "No diff recorded for this action.")}</div>}
                      </div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Tests", "Tests")}</h4>
            {tests.length === 0 ? <div className="text-[12px] text-dim">{L("Aucun test n'a été exécuté pour ce projet.", "No tests have been executed for this project.")}</div> : (
              <ul className="space-y-1.5">
                {tests.map((r) => {
                  const res = r.result as { passed?: boolean; exitCode?: number; runner?: string; command?: string; durationSecs?: number; output?: string } | null;
                  return (
                    <li key={r.id} className="rounded-lg border border-line bg-black/20">
                      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]" onClick={() => setOpenOut(openOut === r.id ? null : r.id)}>
                        <FlaskConical className={cx("h-3.5 w-3.5", res?.passed ? "text-ok" : r.status === "COMPLETED" ? "text-bad" : "text-dim")} />
                        <span className="flex-1">{r.status === "COMPLETED" ? (res?.passed ? L("Tests réussis", "Tests passed") : L(`Tests en échec (exit ${res?.exitCode})`, `Tests failed (exit ${res?.exitCode})`)) : r.error ?? (r.status === "WAITING_PERMISSION" ? L("En attente de votre autorisation", "Waiting for your approval") : r.status === "RUNNING" ? L("Exécution en cours…", "Running…") : r.status)}</span>
                        <span className="font-mono text-[10.5px] text-dim">{res?.command}</span>
                        {res?.durationSecs != null && <span className="font-mono text-[10.5px] text-dim">{res.durationSecs.toFixed(1)} s</span>}
                        {r.status === "COMPLETED"
                          ? <StatusPill status={res?.passed ? "PASSED" : "FAILED"} />
                          : <StatusPill status={r.status} />}
                      </button>
                      {openOut === r.id && res?.output && <pre className="max-h-72 overflow-auto border-t border-line p-3 font-mono text-[10.5px] whitespace-pre-wrap text-fg/80">{res.output}</pre>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {errors.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-bad">{L("Erreurs", "Errors")}</h4>
              <ul className="space-y-1 text-[11.5px]">{errors.slice(0, 20).map((r) => <li key={r.id} className="text-bad/90"><span className="font-mono text-dim">{fmtTime(r.startedAt)} {r.tool}</span> — {r.error}</li>)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Email / document composer

export function ComposerView() {
  const { run, toast } = useNexus();
  const L = useL();
  const [kind, setKind] = useState<"email" | "document">("email");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [atts, setAtts] = useState<{ path: string; ok: boolean; size?: number; error?: string }[]>([]);
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [confirmHandoff, setConfirmHandoff] = useState(false);
  const dirty = !!(to || subject || body || atts.length);

  const draft = async () => {
    setDrafting(true);
    const r = await run(api.aiDraft(kind, instruction, to, subject, body));
    setDrafting(false);
    if (r) { setSubject(r.subject); setBody(r.body); setInstruction(""); }
  };
  const addAttachment = async () => {
    const r = await openDialog({ multiple: true, title: L("Pièces jointes (dossiers autorisés)", "Attachments (authorized folders)") });
    const paths = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    if (paths.length) { const v = await run(api.validateAttachments(paths)); if (v) setAtts((a) => [...a, ...v]); }
  };
  const clear = () => { setTo(""); setSubject(""); setBody(""); setAtts([]); setConfirmHandoff(false); };
  const text = kind === "email" ? `${L("À", "To")}: ${to}\n${L("Objet", "Subject")}: ${subject}\n\n${body}` : `${subject ? `# ${subject}\n\n` : ""}${body}`;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-line bg-black/25 p-0.5">
          {(["email", "document"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx("rounded-md px-2.5 py-1 text-[11px] font-medium", kind === k ? "bg-white/12 text-fg" : "text-mute")}>
              {k === "email" ? L("Nouvel e-mail", "New email") : L("Document", "Document")}
            </button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[10.5px] text-dim"><Plug className="h-3 w-3" />{L("Envoi : aucune intégration e-mail configurée", "Sending: no e-mail integration configured")}</span>
      </div>
      {kind === "email" && <Input placeholder={L("Destinataire", "Recipient")} value={to} onChange={(e) => setTo(e.target.value)} aria-label={L("Destinataire", "Recipient")} />}
      <Input placeholder={kind === "email" ? L("Objet", "Subject") : L("Titre", "Title")} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={L("Message…", "Message…")}
        className="min-h-[180px] flex-1 resize-none rounded-lg border border-line bg-black/25 px-3 py-2 text-[13px] outline-none focus:border-sky/50" aria-label={L("Corps du message", "Message body")} />
      {kind === "email" && (
        <div className="space-y-1">
          {atts.map((a, i) => (
            <div key={i} className={cx("flex items-center gap-2 rounded-md px-2 py-1 text-[11.5px]", a.ok ? "bg-white/[0.04]" : "bg-bad/10 text-bad")}>
              <Paperclip className="h-3 w-3" /><span className="min-w-0 flex-1 truncate font-mono">{a.path}</span>
              <span>{a.ok ? fmtBytes(a.size) : a.error}</span>
              <button onClick={() => setAtts((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><X className="h-3 w-3" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Paperclip className="h-3.5 w-3.5" />} onClick={addAttachment}>{L("Joindre un fichier", "Attach a file")}</Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input placeholder={L("Instruction pour NEXUS : « rédige une relance polie »…", "Instruction for NEXUS: \"write a polite follow-up\"…")} value={instruction} onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && instruction.trim()) void draft(); }} />
        <Button icon={drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} disabled={!instruction.trim() || drafting} onClick={draft}>{L("Rédiger", "Draft")}</Button>
      </div>

      {confirmHandoff && (
        <div className="rounded-xl border border-warn/35 bg-warn/[0.06] p-3 text-[12px]">
          <div className="font-semibold text-warn">{L("Confirmer l'ouverture dans votre messagerie", "Confirm handing off to your mail app")}</div>
          <div className="mt-1 text-fg/85">{L("À", "To")}: <span className="font-mono">{to}</span> · {L("Objet", "Subject")}: {subject || "—"}</div>
          <div className="mt-1 text-mute">{L("NEXUS n'envoie rien : votre application de messagerie s'ouvre avec ce brouillon, et c'est vous qui l'envoyez. Les pièces jointes ne sont pas transmises par ce biais.",
            "NEXUS sends nothing: your mail app opens with this draft and you send it yourself. Attachments are not carried over this way.")}</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ok" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={async () => { await run(api.openInMailClient(to, subject, body), L("Brouillon ouvert dans votre messagerie", "Draft opened in your mail app")); setConfirmHandoff(false); }}>{L("Ouvrir", "Open")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmHandoff(false)}>{L("Annuler", "Cancel")}</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled title={L("Aucune intégration e-mail n'est configurée : NEXUS ne peut pas envoyer.", "No e-mail integration is configured: NEXUS cannot send.")}>{L("Envoyer", "Send")}</Button>
        {kind === "email" && <Button icon={<Mail className="h-4 w-4" />} disabled={!to || !body} onClick={() => setConfirmHandoff(true)}>{L("Ouvrir dans ma messagerie", "Open in my mail app")}</Button>}
        <Button icon={<Copy className="h-4 w-4" />} disabled={!body} onClick={() => navigator.clipboard.writeText(text).then(() => toast(L("Copié dans le presse-papiers", "Copied to clipboard"), "ok"))}>{L("Copier", "Copy")}</Button>
        <Button icon={<Save className="h-4 w-4" />} disabled={!body} onClick={async () => { const p = await run(api.saveDraft(kind, to, subject, body, atts.filter((a) => a.ok).map((a) => a.path))); if (p) toast(`${L("Brouillon enregistré", "Draft saved")} : ${p}`, "ok"); }}>{L("Enregistrer le brouillon", "Save draft")}</Button>
        <span className="flex-1" />
        {dirty && <ConfirmButton variant="ghost" confirmLabel={L("Tout effacer ?", "Discard?")} onConfirm={clear}>{L("Annuler", "Cancel")}</ConfirmButton>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Integrations

const ST: Record<string, { fr: string; en: string; cls: string }> = {
  connected: { fr: "Connecté", en: "Connected", cls: "text-ok border-ok/30 bg-ok/10" },
  disconnected: { fr: "Déconnecté", en: "Disconnected", cls: "text-mute border-line bg-white/5" },
  auth_required: { fr: "Authentification requise", en: "Authentication required", cls: "text-warn border-warn/30 bg-warn/10" },
  error: { fr: "Erreur", en: "Error", cls: "text-bad border-bad/30 bg-bad/10" },
  not_configured: { fr: "Non configuré", en: "Not configured", cls: "text-dim border-line bg-white/[0.03]" },
};

export function IntegrationsView() {
  const { run, lang } = useNexus();
  const L = useL();
  const [items, setItems] = useState<Integration[] | null>(null);
  const [testing, setTesting] = useState(false);
  const load = () => api.integrationsStatus().then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);
  useEvent("nexus://integrations", () => void load());
  const [services, local] = useMemo(() => [(items ?? []).filter((i) => !i.local), (items ?? []).filter((i) => i.local)], [items]);
  const Card = (i: Integration) => {
    const base = ST[i.status] ?? ST.not_configured!;
    // Local tools are detected, not "connected".
    const st = i.local ? { ...base, fr: i.status === "connected" ? "Disponible" : "Introuvable", en: i.status === "connected" ? "Available" : "Not found" } : base;
    return (
      <div key={i.id} className="rounded-xl border border-line bg-black/20 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{i.name}</span>
          <span className={cx("ml-auto rounded-md border px-1.5 py-px text-[10px] font-semibold", st.cls)}>{lang === "en" ? st.en : st.fr}</span>
        </div>
        <div className="mt-1 text-[11.5px] text-mute">{i.detail}</div>
        {i.actions.includes("test") && (
          <Button size="sm" className="mt-2" icon={testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} disabled={testing || i.status === "not_configured"}
            onClick={async () => { setTesting(true); await run(api.testAi()); setTesting(false); void load(); }}>{L("Tester la connexion", "Test connection")}</Button>
        )}
        {!i.implemented && <div className="mt-2 text-[10.5px] text-dim">{L("Aucune action disponible : intégration non implémentée.", "No actions available: integration not implemented.")}</div>}
      </div>
    );
  };
  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Services", "Services")}</span>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { setItems(null); void load(); }}>{L("Vérifier", "Check")}</Button>
      </div>
      {items === null ? <div className="flex items-center gap-2 text-[12px] text-mute"><Loader2 className="h-3.5 w-3.5 animate-spin" />{L("Vérification réelle en cours…", "Running real checks…")}</div> : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">{services.map(Card)}</div>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">{L("Outils de développement locaux", "Local development tools")}</span>
          <div className="grid gap-2 sm:grid-cols-2">{local.map(Card)}</div>
        </>
      )}
    </div>
  );
}
