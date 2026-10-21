import {
  AlertTriangle, AppWindow, Brain, Check, ChevronRight, CircleDashed, FileText, Globe, Keyboard, ListTodo,
  Loader2, MessageSquarePlus, MonitorSmartphone, MousePointerClick, Send, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ApprovalCard } from "../components/Approval";
import { Markdown } from "../components/Markdown";
import { Button, RiskBadge, StatusPill, cx, fmtTime } from "../components/ui";
import { StopButton } from "../App";
import { api, type ContentBlock, type Conversation, type StoredMessage, type ToolRun } from "../lib/api";
import { useEvent, useL, useNexus } from "../lib/store";

export interface LiveTool {
  id: string;
  tool: string;
  status: string;
  summary?: string | null;
  error?: string | null;
  verified?: boolean | null;
  durationMs?: number | null;
  input?: unknown;
}

function toolIcon(name: string) {
  if (name.startsWith("desktop.open") || name.startsWith("desktop.close") || name.includes("window")) return AppWindow;
  if (name.includes("screenshot") || name.includes("monitor") || name.includes("highlight")) return MonitorSmartphone;
  if (name.includes("click") || name.includes("mouse") || name.includes("drag") || name.includes("scroll")) return MousePointerClick;
  if (name.includes("type") || name.includes("key")) return Keyboard;
  if (name.startsWith("filesystem")) return FileText;
  if (name.startsWith("browser")) return Globe;
  if (name.startsWith("memory")) return Brain;
  if (name.startsWith("nexus.set_plan")) return ListTodo;
  return CircleDashed;
}

const apiToName = (n: string) => n.replace("_", ".");

export function PlanCard({ input }: { input: { steps?: string[]; completed_steps?: number } }) {
  const L = useL();
  const steps = input.steps ?? [];
  const done = input.completed_steps ?? 0;
  return (
    <div className="glass my-2 border-violet/25 bg-violet/[0.04] px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet">{L("Plan", "Plan")}</div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold",
              i < done ? "border-ok/50 bg-ok/15 text-ok" : i === done ? "border-sky/50 text-sky" : "border-line text-dim")}>
              {i < done ? <Check className="h-2.5 w-2.5" /> : i + 1}
            </span>
            <span className={cx(i < done ? "text-mute line-through decoration-white/20" : "text-fg/90")}>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ToolCard({ t }: { t: LiveTool }) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(t.tool);
  const running = ["VALIDATING", "CHECKING", "RUNNING", "REQUESTED"].includes(t.status);
  const failed = ["FAILED", "DENIED", "CANCELLED"].includes(t.status);
  return (
    <div className={cx("my-1.5 rounded-xl border bg-black/20 text-[12.5px]", failed ? "border-bad/25" : t.status === "WAITING_PERMISSION" ? "border-warn/30" : "border-line")}>
      <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky" /> : <Icon className={cx("h-3.5 w-3.5", failed ? "text-bad" : "text-mute")} />}
        <span className="min-w-0 flex-1 truncate text-fg/90">{t.summary || t.tool}</span>
        {t.verified === true && <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-ok"><Check className="h-3 w-3" />{L("vérifié", "verified")}</span>}
        {t.verified === false && <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-warn"><AlertTriangle className="h-3 w-3" />{L("non vérifié", "unverified")}</span>}
        {t.durationMs != null && <span className="font-mono text-[10.5px] text-dim">{t.durationMs} ms</span>}
        <StatusPill status={t.status} />
        <ChevronRight className={cx("h-3.5 w-3.5 text-dim transition-transform", open && "rotate-90")} />
      </button>
      {t.error && <div className="border-t border-line px-3 py-2 text-[12px] text-bad/90">{t.error}</div>}
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          <div className="font-mono text-[11px] text-mute">{t.tool}</div>
          {t.input !== undefined && (
            <pre className="max-h-48 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-fg/80">{JSON.stringify(t.input, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function runToLive(r: ToolRun): LiveTool {
  return { id: r.id, tool: r.tool, status: r.status, summary: (r.result as { summary?: string } | null)?.summary ?? r.summary, error: r.error, verified: r.verified, durationMs: r.durationMs, input: r.input };
}

function isContextBlock(b: ContentBlock) {
  return b.type === "text" && typeof b.text === "string" && b.text.startsWith("<context>");
}

export default function ChatPage() {
  const { state, approvals, run, pageArg, lang } = useNexus();
  const L = useL();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(pageArg ?? null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [tools, setTools] = useState<Record<string, LiveTool>>({});
  const [live, setLive] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const convRef = useRef(convId);
  convRef.current = convId;

  const loadConvs = useCallback(() => { api.listConversations().then(setConvs).catch(() => {}); }, []);
  const loadConv = useCallback(async (id: string) => {
    const c = await api.getConversation(id);
    setMessages(c.messages);
    const m: Record<string, LiveTool> = {};
    for (const r of c.toolRuns) m[r.id] = runToLive(r);
    setTools(m);
    setLive("");
    setPendingUser(null);
  }, []);

  useEffect(loadConvs, [loadConvs]);
  useEffect(() => {
    if (convId) loadConv(convId).catch(() => {});
    else { setMessages([]); setTools({}); }
  }, [convId, loadConv]);

  useEvent<{ conversationId: string; type: string; text?: string; message?: string; id?: string; tool?: string; summary?: string }>("nexus://chat", (e) => {
    if (e.conversationId !== convRef.current) return;
    if (e.type === "usage" && e.summary) setUsage(e.summary);
    if (e.type === "text_delta") { setThinking(false); setLive((l) => l + (e.text ?? "")); }
    if (e.type === "thinking") setThinking(true);
    if (e.type === "tool_use_start" && e.id) {
      setThinking(false);
      setTools((t) => ({ ...t, [e.id!]: { id: e.id!, tool: e.tool ?? "", status: "REQUESTED" } }));
    }
    if (e.type === "message_done") { setThinking(false); loadConv(e.conversationId).catch(() => {}); }
    if (e.type === "error") setError(e.message ?? "Error");
    if (e.type === "done") { setThinking(false); loadConv(e.conversationId).catch(() => {}); loadConvs(); }
  });
  useEvent<LiveTool & { conversationId: string }>("nexus://tool", (e) => {
    if (e.conversationId !== convRef.current) return;
    setTools((t) => ({ ...t, [e.id]: { ...t[e.id], ...e, input: e.input ?? t[e.id]?.input } }));
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, live, tools, approvals.length, pendingUser]);

  const send = async () => {
    const t = text.trim();
    if (!t || state?.agentRunning) return;
    setError(null);
    setUsage(null);
    setText("");
    setPendingUser(t);
    setLive("");
    setThinking(true);
    const id = await run(api.sendMessage(convId, t));
    if (id) {
      if (id !== convId) setConvId(id);
      loadConvs();
    } else {
      setPendingUser(null);
      setThinking(false);
      setText(t);
    }
  };

  const busy = !!state?.agentRunning && (convId !== null);
  const rendered = useMemo(() => {
    const out: ReactElement[] = [];
    messages.forEach((m, mi) => {
      if (m.role === "user") {
        const texts = m.content.filter((b) => b.type === "text" && !isContextBlock(b));
        if (texts.length === 0) return;
        out.push(
          <div key={mi} className="flex justify-end">
            <div className="max-w-[78%] rounded-2xl rounded-br-md border border-sky/20 bg-sky/[0.08] px-4 py-2.5 text-[13.5px] whitespace-pre-wrap">
              {texts.map((b) => (b as { text: string }).text).join("\n")}
            </div>
          </div>,
        );
        return;
      }
      out.push(
        <div key={mi} className="max-w-[88%]">
          {m.content.map((b, bi) => {
            if (b.type === "text") return <Markdown key={bi} text={(b as { text: string }).text} />;
            if (b.type === "tool_use") {
              const tb = b as { id: string; name: string; input: unknown };
              if (tb.name === "nexus_set_plan") return <PlanCard key={bi} input={tb.input as { steps?: string[] }} />;
              const t = tools[tb.id] ?? { id: tb.id, tool: apiToName(tb.name), status: "REQUESTED", input: tb.input };
              return <ToolCard key={bi} t={{ ...t, input: t.input ?? tb.input }} />;
            }
            return null;
          })}
        </div>,
      );
    });
    return out;
  }, [messages, tools]);

  // Tools requested in the turn currently streaming (not yet in stored messages).
  const storedToolIds = new Set(messages.flatMap((m) => m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id)));
  const liveTools = Object.values(tools).filter((t) => !storedToolIds.has(t.id));

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line max-xl:hidden">
        <div className="p-3">
          <Button className="w-full" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => { setConvId(null); setError(null); }}>
            {L("Nouvelle conversation", "New conversation")}
          </Button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {convs.map((c) => (
            <div key={c.id} className={cx("group flex items-center rounded-lg", c.id === convId ? "bg-white/[0.07]" : "hover:bg-white/[0.035]")}>
              <button className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => { setConvId(c.id); setError(null); }}>
                <div className="truncate text-[12.5px] text-fg/90">{c.title}</div>
                <div className="text-[10.5px] text-dim">{fmtTime(c.updatedAt, true)}</div>
              </button>
              <button className="mr-1 hidden rounded p-1 text-dim hover:text-bad group-hover:block" title={L("Supprimer", "Delete")}
                onClick={async () => { await run(api.deleteConversation(c.id)); if (c.id === convId) setConvId(null); loadConvs(); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scroller} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            {messages.length === 0 && !pendingUser && (
              <div className="pt-16">
                <div className="text-center font-display text-3xl font-semibold tracking-tight"><span className="accent-text">NEXUS</span></div>
                <p className="mt-2 text-center text-[13px] text-mute">{L("Demandez une action réelle sur votre PC.", "Ask for a real action on your PC.")}</p>
                {!state?.aiConfigured && (
                  <div className="mx-auto mt-6 max-w-md rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-center text-xs text-warn">
                    {L("Aucune clé API configurée. Ajoutez votre clé Anthropic dans Paramètres → IA.", "No API key configured. Add your Anthropic key in Settings → AI.")}
                  </div>
                )}
                <div className="mx-auto mt-8 grid max-w-xl grid-cols-2 gap-2">
                  {(lang === "en"
                    ? ["Open Opera GX", "What's using my RAM right now?", "Create notes.txt in my NEXUS workspace with today's date", "Take a screenshot and tell me what's on my screen"]
                    : ["Ouvre Opera GX", "Qu'est-ce qui utilise ma RAM en ce moment ?", "Crée notes.txt dans mon espace NEXUS avec la date du jour", "Fais une capture d'écran et dis-moi ce qu'il y a à l'écran"]
                  ).map((s) => (
                    <button key={s} onClick={() => setText(s)} className="rounded-xl border border-line bg-panel px-3 py-2.5 text-left text-[12.5px] text-mute transition-colors hover:border-line-2 hover:text-fg">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {rendered}
            {pendingUser && !messages.some((m) => m.role === "user" && m.content.some((b) => b.type === "text" && (b as { text: string }).text === pendingUser)) && (
              <div className="flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md border border-sky/20 bg-sky/[0.08] px-4 py-2.5 text-[13.5px] whitespace-pre-wrap">{pendingUser}</div>
              </div>
            )}
            {(live || liveTools.length > 0) && (
              <div className="max-w-[88%]">
                {live && <Markdown text={live} />}
                {liveTools.map((t) => <ToolCard key={t.id} t={t} />)}
              </div>
            )}
            {busy && thinking && !live && (
              <div className="flex items-center gap-2 text-[12.5px] text-mute"><Loader2 className="h-3.5 w-3.5 animate-spin text-sky" />{L("NEXUS réfléchit…", "NEXUS is thinking…")}</div>
            )}
            {approvals.map((a) => <ApprovalCard key={a.id} req={a} />)}
            {usage && !state?.agentRunning && (
              <div className="text-right font-mono text-[10.5px] text-dim" title={L("Estimation ; le montant exact est dans la console Anthropic", "Estimate; the exact amount is in the Anthropic console")}>{usage}</div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/[0.07] px-3 py-2.5 text-[12.5px] text-bad">
                <X className="mt-0.5 h-4 w-4 shrink-0" /><span className="whitespace-pre-wrap">{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-line bg-black/20 px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <div className="glass flex min-w-0 flex-1 items-end gap-2 bg-black/30 px-3 py-2 focus-within:border-sky/40">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                rows={Math.min(6, Math.max(1, text.split("\n").length))}
                placeholder={L("Demandez à NEXUS… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)", "Ask NEXUS… (Enter to send, Shift+Enter for a new line)")}
                className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] text-fg outline-none placeholder:text-dim"
              />
              <Button variant="primary" size="sm" className="h-8 w-8 !px-0" disabled={!text.trim() || !!state?.agentRunning} onClick={() => void send()} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {state?.agentRunning && <StopButton />}
          </div>
          <div className="mx-auto mt-2 flex max-w-3xl items-center gap-3 text-[10.5px] text-dim">
            <span>{L("Mode", "Mode")}: <span className="font-semibold text-mute">{state?.mode}</span></span>
            <span>·</span>
            <span>{L("Les actions à risque demandent votre accord.", "Risky actions ask for your approval.")}</span>
            <span className="ml-auto flex items-center gap-1"><RiskBadge risk="LOW" /><RiskBadge risk="MEDIUM" /><RiskBadge risk="HIGH" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
