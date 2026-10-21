// Typed wrappers around the Tauri commands exposed by the Rust backend.
import { invoke } from "@tauri-apps/api/core";

export type Mode = "MANUAL" | "AI" | "COPILOT";
export type AgentStatus =
  | "IDLE" | "THINKING" | "PLANNING" | "WAITING_PERMISSION" | "EXECUTING"
  | "VERIFYING" | "COMPLETED" | "ERROR" | "STOPPED";
export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type ScopeStatus = "default" | "always" | "deny";
export type AppStatus = "ask" | "allowed" | "blocked";
export type ApprovalChoice = "deny" | "once" | "always";

export interface NexusState {
  status: AgentStatus;
  mode: Mode;
  stopped: boolean;
  agentRunning: boolean;
  provider: string;
  model: string;
  aiConfigured: boolean;
  pendingApprovals: number;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  summary: string;
  details: [string, string][];
  risk: Risk;
  scope: string;
  reason: string;
  allowAlways: boolean;
  taskId: string | null;
  createdAt: string;
}

export interface MonitorInfo {
  index: number;
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface Frame {
  monitor: MonitorInfo;
  width: number;
  height: number;
  mediaType: string;
  data: string;
  captureMs: number;
}

export interface Highlight {
  monitor: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  screenX: number;
  screenY: number;
}

export interface WindowInfo {
  hwnd: number;
  title: string;
  pid: number;
  process: string;
  exePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
}

export interface SystemSnapshot {
  system: {
    cpuPercent: number;
    cpuCount: number;
    cpuBrand: string;
    memoryUsed: number;
    memoryTotal: number;
    os: string;
    host: string;
    uptimeSecs: number;
  };
  battery: { present: boolean; percent: number | null; charging: boolean; onAc: boolean };
  activeWindow: WindowInfo | null;
}

export interface AppRow {
  id: string;
  name: string;
  exePath: string | null;
  launchTarget: string;
  source: string;
  installDir: string | null;
  expectedProcess: string | null;
  status: AppStatus;
  running: boolean;
}

export interface PermissionRow {
  scope: string;
  description: string;
  risk: Risk;
  status: ScopeStatus;
  lastUsed: string | null;
  useCount: number;
  tools: string[];
}

export interface Workspace {
  id: number;
  path: string;
  label: string;
  exists: boolean;
}

export interface FileItem {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
  protected: boolean;
}

export interface ActivityRow {
  id?: number;
  ts: string;
  kind: string;
  action: string;
  tool: string | null;
  status: string;
  risk: string | null;
  permission: string | null;
  result: string | null;
  error: string | null;
  taskId: string | null;
}

export interface ToolRun {
  id: string;
  taskId: string | null;
  conversationId: string | null;
  tool: string;
  input: unknown;
  status: string;
  risk: Risk;
  permission: string;
  decision: string | null;
  summary: string | null;
  result: { summary?: string } | Record<string, unknown> | null;
  error: string | null;
  verified: boolean | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface TaskRow {
  id: string;
  conversationId: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  progress: number;
  toolRuns: number;
  outcome?: string | null;
}

export interface TaskDetail {
  steps: { idx: number; title: string; status: string }[];
  toolRuns: ToolRun[];
  logs: { ts: string; action: string; status: string; error: string | null }[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export interface StoredMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
  createdAt: string;
}

export interface MemoryRow {
  id: number;
  kind: string;
  projectId: string | null;
  projectName: string | null;
  content: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  memoryCount: number;
  taskCount: number;
}

export interface Settings {
  aiProvider: string;
  anthropicModel: string;
  openaiModel: string;
  effort: string;
  temperature: number | null;
  mediumRequiresApproval: boolean;
  defaultMode: Mode;
  streamMaxWidth: number;
  streamQuality: number;
  aiScreenshotMaxWidth: number;
  defaultBrowser: string;
  searchEngine: string;
  memoryEnabled: boolean;
  animations: boolean;
  density: string;
  language: string;
  calendarClientId: string;
  companionEnabled: boolean;
  companionShowOnStart: boolean;
  companionAlwaysOnTop: boolean;
  companionPosition: [number, number] | null;
  companionAnimation: "full" | "subtle" | "off";
  companionSounds: boolean;
  companionAccent: string;
  companionActions: string[];
  companionShortcut: string;
  startWithWindows: boolean;
  voiceEnabled: boolean;
  voiceModel: string;
  voiceShortcut: string;
  voiceSpeakReplies: boolean;
  voiceName: string;
  voiceRate: number;
  voiceDevice: string;
  voiceVolume: number;
  voiceMuted: boolean;
  closeToTray: boolean;
  startMinimized: boolean;
}

export interface VoiceStatus {
  enabled: boolean;
  model: string;
  modelReady: boolean;
  models: { id: string; sizeMB: number; ready: boolean }[];
  recording: boolean;
  downloading: boolean;
  microphone: string | null;
  devices: string[];
}

export interface InboxFile {
  name: string;
  path: string;
  category: "pdf" | "image" | "document" | "archive" | "text" | "data" | "code" | "unsupported";
  size: number;
  added: string | null;
}

export type IntegrationStatus = "connected" | "disconnected" | "auth_required" | "error" | "not_configured";
export interface Integration {
  id: string;
  name: string;
  status: IntegrationStatus;
  detail: string;
  actions: string[];
  implemented: boolean;
  local?: boolean;
  model?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  scope: string;
  risk: Risk;
  kind: "read" | "act";
}

export const api = {
  getState: () => invoke<NexusState>("get_state"),
  stop: () => invoke<void>("stop_nexus"),
  rearm: () => invoke<void>("rearm_nexus"),
  setMode: (mode: Mode) => invoke<void>("set_mode", { mode }),

  listApprovals: () => invoke<ApprovalRequest[]>("list_approvals"),
  resolveApproval: (id: string, choice: ApprovalChoice) => invoke<void>("resolve_approval", { id, choice }),

  /** `voice`: spoken request, the answer will be read aloud (short conversational reply). */
  sendMessage: (conversationId: string | null, text: string, voice = false) =>
    invoke<string>("send_message", { conversationId, text, voice }),
  listConversations: () => invoke<Conversation[]>("list_conversations"),
  getConversation: (id: string) =>
    invoke<{ messages: StoredMessage[]; toolRuns: ToolRun[] }>("get_conversation", { id }),
  deleteConversation: (id: string) => invoke<void>("delete_conversation", { id }),
  listToolRuns: (limit?: number) => invoke<ToolRun[]>("list_tool_runs", { limit }),
  listTools: () => invoke<ToolDef[]>("list_tools"),

  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  captureFrame: (monitor: number, maxWidth?: number, quality?: number) =>
    invoke<Frame>("capture_frame", { monitor, maxWidth, quality }),
  screenshotToFile: (monitor: number) => invoke<string>("screenshot_to_file", { monitor }),
  mouse: (monitor: number, fx: number, fy: number, action: "move" | "click" | "double" | "right" | "middle" | "down" | "up") =>
    invoke<[number, number]>("manual_mouse", { monitor, fx, fy, action }),
  drag: (monitor: number, fx1: number, fy1: number, fx2: number, fy2: number) =>
    invoke<void>("manual_drag", { monitor, fx1, fy1, fx2, fy2 }),
  scroll: (monitor: number, fx: number, fy: number, dy: number, dx?: number) =>
    invoke<void>("manual_scroll", { monitor, fx, fy, dy, dx }),
  typeText: (text: string) => invoke<number>("manual_type", { text }),
  key: (key: string, action: "press" | "down" | "up" = "press") => invoke<void>("manual_key", { key, action }),
  hotkey: (keys: string[]) => invoke<void>("manual_hotkey", { keys }),
  cursor: () => invoke<[number, number]>("cursor_position"),
  getHighlight: () => invoke<Highlight | null>("get_highlight"),
  clearHighlight: () => invoke<void>("clear_highlight"),
  executeHighlight: () => invoke<void>("execute_highlight"),

  systemSnapshot: () => invoke<SystemSnapshot>("system_snapshot"),
  listWindows: () => invoke<WindowInfo[]>("list_windows"),

  listApps: () => invoke<AppRow[]>("list_apps"),
  rescanApps: () => invoke<{ count: number; warnings: string[] }>("rescan_apps"),
  setAppStatus: (id: string, status: AppStatus) => invoke<void>("set_app_status", { id, status }),
  launchApp: (id: string) => invoke<void>("launch_app", { id }),
  openUrl: (url: string) => invoke<string>("open_url", { url }),
  webSearch: (query: string) => invoke<string>("web_search", { query }),

  listPermissions: () => invoke<PermissionRow[]>("list_permissions"),
  setPermission: (scope: string, status: ScopeStatus) => invoke<void>("set_permission", { scope, status }),
  permissionHistory: (scope: string) => invoke<ToolRun[]>("permission_history", { scope }),

  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  addWorkspace: (path: string) => invoke<Workspace>("add_workspace", { path }),
  removeWorkspace: (id: number) => invoke<void>("remove_workspace", { id }),
  browseFolder: (path?: string) => invoke<{ path: string; items: FileItem[] }>("browse_folder", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),

  listActivity: (limit?: number, kind?: string) => invoke<ActivityRow[]>("list_activity", { limit, kind }),
  clearActivity: () => invoke<void>("clear_activity"),
  listTasks: () => invoke<TaskRow[]>("list_tasks"),
  getTask: (id: string) => invoke<TaskDetail>("get_task", { id }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),

  listMemory: () => invoke<MemoryRow[]>("list_memory"),
  addMemory: (content: string, project?: string) => invoke<number>("add_memory", { content, project }),
  deleteMemory: (id: number) => invoke<void>("delete_memory", { id }),
  clearMemory: () => invoke<void>("clear_memory"),
  listProjects: () => invoke<Project[]>("list_projects"),
  saveProject: (p: { id?: string; name: string; description: string; notes: string }) =>
    invoke<string>("save_project", { id: p.id ?? null, name: p.name, description: p.description, notes: p.notes }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  secretStatus: () => invoke<Record<string, boolean>>("secret_status"),
  setSecret: (name: string, value: string) => invoke<void>("set_secret", { name, value }),
  clearSecret: (name: string) => invoke<void>("clear_secret", { name }),
  testAi: () => invoke<string>("test_ai_connection"),

  companionShow: () => invoke<void>("companion_show"),
  companionHide: () => invoke<void>("companion_hide"),
  companionToggle: () => invoke<void>("companion_toggle"),
  companionMinimize: () => invoke<void>("companion_minimize"),
  companionResize: (mode: "pet" | "bar" | "compact" | "expanded", scale?: number) => invoke<void>("companion_resize", { mode, scale }),
  appQuit: () => invoke<void>("app_quit"),
  companionCursor: () => invoke<[number, number] | null>("companion_cursor"),
  showMain: (page?: string, arg?: string) => invoke<void>("show_main", { page: page ?? null, arg: arg ?? null }),
  startupStatus: () => invoke<boolean>("startup_status"),
  importFiles: (paths: string[]) =>
    invoke<({ ok: true; file: InboxFile } | { ok: false; name: string; error: string })[]>("import_files", { paths }),
  listInbox: () => invoke<InboxFile[]>("list_inbox"),
  removeInboxFile: (path: string) => invoke<void>("remove_inbox_file", { path }),
  extractFileText: (path: string) => invoke<{ kind: string; text: string; totalChars: number; truncated: boolean }>("extract_file_text", { path }),
  addFileToProject: (projectId: string, path: string) => invoke<void>("add_file_to_project", { projectId, path }),
  listProjectFiles: (projectId: string) => invoke<{ id: number; path: string; exists: boolean; addedAt: string }[]>("list_project_files", { projectId }),
  validateAttachments: (paths: string[]) => invoke<{ path: string; ok: boolean; size?: number; error?: string }[]>("validate_attachments", { paths }),
  saveDraft: (kind: string, to: string, subject: string, body: string, attachments: string[]) =>
    invoke<string>("save_draft", { kind, to, subject, body, attachments }),
  openInMailClient: (to: string, subject: string, body: string) => invoke<void>("open_in_mail_client", { to, subject, body }),
  aiDraft: (kind: string, instruction: string, to: string, subject: string, body: string) =>
    invoke<{ subject: string; body: string }>("ai_draft", { kind, instruction, to, subject, body }),
  integrationsStatus: () => invoke<Integration[]>("integrations_status"),
  voiceStatus: () => invoke<VoiceStatus>("voice_status"),
  voiceDownloadModel: (model: string) => invoke<void>("voice_download_model", { model }),
  voiceStart: (autoStop = false) => invoke<void>("voice_start", { autoStop }),
  voiceStop: () => invoke<string>("voice_stop"),
  voiceCancel: () => invoke<void>("voice_cancel"),
  ttsStatus: () => invoke<{ available: boolean; voices: string[] }>("tts_status"),
  /** Natural local voice (Piper): returns a WAV data URL. */
  ttsSpeak: (text: string, voice: string, rate?: number) => invoke<string>("tts_speak", { text, voice, rate }),
  /** Runs one registry tool through the full permission pipeline (Companion quick actions). */
  invokeTool: (name: string, input: Record<string, unknown>) =>
    invoke<{ isError: boolean; text: string; outcome: string; toolRunId: string }>("invoke_tool", { name, input }),
};

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
