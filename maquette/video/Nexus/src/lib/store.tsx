import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api, errMsg, type ApprovalRequest, type NexusState, type Settings } from "./api";

export type Page =
  | "home" | "chat" | "control" | "studio" | "tasks" | "calendar" | "projects" | "files"
  | "browser" | "automations" | "activity" | "permissions" | "settings";

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
}

interface Ctx {
  state: NexusState | null;
  refresh: () => void;
  approvals: ApprovalRequest[];
  settings: Settings | null;
  reloadSettings: () => void;
  lang: "fr" | "en";
  page: Page;
  go: (p: Page, arg?: string) => void;
  pageArg: string | undefined;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
  run: <T>(p: Promise<T>, ok?: string) => Promise<T | undefined>;
  outcome: { value: string; at: number; conversationId: string } | null;
}

const NexusCtx = createContext<Ctx | null>(null);

/** Subscribe to a backend event for the component's lifetime. */
export function useEvent<T>(name: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let un: UnlistenFn | undefined;
    let dead = false;
    listen<T>(name, (e) => ref.current(e.payload)).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, [name]);
}

export function NexusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NexusState | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [pageArg, setPageArg] = useState<string | undefined>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [outcome, setOutcome] = useState<Ctx["outcome"]>(null);

  const refresh = useCallback(() => {
    api.getState().then(setState).catch(() => {});
  }, []);
  const reloadSettings = useCallback(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    reloadSettings();
    api.listApprovals().then(setApprovals).catch(() => {});
  }, [refresh, reloadSettings]);

  useEvent("nexus://status", refresh);
  useEvent("nexus://mode", refresh);
  useEvent("nexus://chat", (p: { type: string }) => {
    if (p.type === "done" || p.type === "error") refresh();
  });
  useEvent("nexus://settings", () => { reloadSettings(); refresh(); });
  useEvent<{ page: Page; arg?: string | null }>("nexus://navigate", ({ page: p, arg }) => { setPage(p); setPageArg(arg ?? undefined); });
  useEvent<{ outcome: string; conversationId: string }>("nexus://outcome", (o) => setOutcome({ value: o.outcome, at: Date.now(), conversationId: o.conversationId }));
  useEvent<ApprovalRequest>("nexus://approval", (req) => {
    setApprovals((a) => [...a.filter((x) => x.id !== req.id), req]);
    refresh();
  });
  useEvent<{ id: string }>("nexus://approval-resolved", ({ id }) => {
    setApprovals((a) => a.filter((x) => x.id !== id));
    refresh();
  });

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);

  const run = useCallback(
    async <T,>(p: Promise<T>, ok?: string) => {
      try {
        const r = await p;
        if (ok) toast(ok, "ok");
        return r;
      } catch (e) {
        toast(errMsg(e), "error");
        return undefined;
      }
    },
    [toast],
  );

  const go = useCallback((p: Page, arg?: string) => {
    setPage(p);
    setPageArg(arg);
  }, []);

  const lang = settings?.language === "en" ? "en" : "fr";

  return (
    <NexusCtx.Provider value={{ state, refresh, approvals, settings, reloadSettings, lang, page, go, pageArg, toast, toasts, run, outcome }}>
      {children}
    </NexusCtx.Provider>
  );
}

export function useNexus(): Ctx {
  const c = useContext(NexusCtx);
  if (!c) throw new Error("useNexus outside provider");
  return c;
}

/** Inline bilingual strings: L("Ouvrir", "Open"). */
export function useL() {
  const { lang } = useNexus();
  return useCallback((fr: string, en: string) => (lang === "en" ? en : fr), [lang]);
}
