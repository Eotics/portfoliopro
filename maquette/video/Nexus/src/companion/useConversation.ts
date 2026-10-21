import { useCallback, useEffect, useRef, useState } from "react";
import { api, type StoredMessage } from "../lib/api";
import { runToLive, type LiveTool } from "../pages/Chat";
import { useEvent, useNexus } from "../lib/store";

const KEY = "nexus.companion.conversation";

function stored(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** The Companion's own conversation, running on the same agent as the main Chat. */
export function useConversation() {
  const { run, refresh } = useNexus();
  const [convId, setConvIdState] = useState<string | null>(stored);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [tools, setTools] = useState<Record<string, LiveTool>>({});
  const [live, setLive] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(convId);
  ref.current = convId;

  const setConvId = (id: string | null) => {
    setConvIdState(id);
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* optional */ }
  };

  const load = useCallback(async (id: string) => {
    try {
      const c = await api.getConversation(id);
      setMessages(c.messages);
      const m: Record<string, LiveTool> = {};
      for (const r of c.toolRuns) m[r.id] = runToLive(r);
      setTools(m);
      setLive("");
      setPending(null);
    } catch {
      // Conversation was deleted from the main window.
      setConvId(null);
      setMessages([]);
    }
  }, []);

  useEffect(() => { if (convId) void load(convId); else { setMessages([]); setTools({}); } }, [convId, load]);

  useEvent<{ conversationId: string; type: string; text?: string; message?: string; id?: string; tool?: string }>("nexus://chat", (e) => {
    if (e.conversationId !== ref.current) return;
    if (e.type === "text_delta") setLive((l) => l + (e.text ?? ""));
    if (e.type === "tool_use_start" && e.id) setTools((t) => ({ ...t, [e.id!]: { id: e.id!, tool: e.tool ?? "", status: "REQUESTED" } }));
    if (e.type === "message_done" || e.type === "done") void load(e.conversationId);
    if (e.type === "error") setError(e.message ?? "Error");
  });
  useEvent<LiveTool & { conversationId: string }>("nexus://tool", (e) => {
    if (e.conversationId !== ref.current) return;
    setTools((t) => ({ ...t, [e.id]: { ...t[e.id], ...e, input: e.input ?? t[e.id]?.input } }));
  });

  const send = async (text: string, voice = false) => {
    const t = text.trim();
    if (!t) return false;
    setError(null);
    setPending(t);
    setLive("");
    const id = await run(api.sendMessage(ref.current, t, voice));
    refresh();
    if (!id) { setPending(null); return false; }
    if (id !== ref.current) setConvId(id);
    return true;
  };

  const reset = () => { setConvId(null); setError(null); setLive(""); setPending(null); };

  return { convId, messages, tools, live, pending, error, send, reset, setError };
}
