import { Brain, KeyRound, Plug, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, ConfirmButton, Empty, Input, NotImplemented, PageHeader, RiskBadge, Select, StatusPill, Toggle, cx, fmtTime } from "../components/ui";
import { api, errMsg, type AppRow, type MemoryRow, type Settings, type ToolDef, type ToolRun, type VoiceStatus } from "../lib/api";
import { PIPER_NAMES, PIPER_PREFIX, listVoices, speak } from "../lib/speech";
import { useEvent, useL, useNexus } from "../lib/store";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 max-w-xl text-[11.5px] text-mute">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

const QUICK: { id: string; fr: string; en: string }[] = [
  { id: "home", fr: "Accueil", en: "Home" }, { id: "chat", fr: "Chat", en: "Chat" }, { id: "task", fr: "Nouvelle tâche", en: "New task" },
  { id: "files", fr: "Ajouter des fichiers", en: "Add files" }, { id: "control", fr: "Panneau de contrôle", en: "Control Panel" },
  { id: "settings", fr: "Paramètres", en: "Settings" }, { id: "search", fr: "Recherche web", en: "Web search" },
  { id: "app", fr: "Ouvrir une app", en: "Open an app" }, { id: "calendar", fr: "Calendrier", en: "Calendar" },
  { id: "composer", fr: "Rédiger", en: "Compose" },
];

/** Opens the real microphone for a few seconds and shows its live level. */
function MicTest({ enabled }: { enabled: boolean }) {
  const L = useL();
  const { toast } = useNexus();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  useEvent<{ type: string; level?: number }>("nexus://voice", (e) => {
    if (!testing || e.type !== "level") return;
    setLevel(e.level ?? 0);
    setPeak((p) => Math.max(p, e.level ?? 0));
  });
  const start = async () => {
    setPeak(0);
    try {
      await api.voiceStart(false);
      setTesting(true);
      window.setTimeout(() => { void api.voiceCancel(); setTesting(false); setLevel(0); }, 5000);
    } catch (e) { toast(errMsg(e), "error"); }
  };
  // RMS levels are small numbers: speech is roughly 0.02-0.3.
  const pct = (v: number) => Math.min(100, Math.round(Math.sqrt(v / 0.3) * 100));
  return (
    <Row label={L("Tester le micro", "Test microphone")} hint={testing ? L("Parlez… (5 secondes)", "Speak… (5 seconds)") : peak > 0 ? (peak < 0.01 ? L("Presque aucun son capté : vérifiez le micro choisi.", "Almost no sound picked up: check the selected microphone.") : L("Le micro fonctionne.", "The microphone works.")) : L("Le niveau affiché est le vrai signal du micro.", "The level shown is the real microphone signal.")}>
      <div className="h-2.5 w-48 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-[#5eead4] to-sky transition-[width] duration-75" style={{ width: `${testing ? pct(level) : 0}%` }} />
      </div>
      <Button size="sm" disabled={!enabled || testing} onClick={start}>{testing ? L("Écoute…", "Listening…") : L("Tester", "Test")}</Button>
    </Row>
  );
}

function VoiceSettings({ s, set }: { s: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  const L = useL();
  const { run, lang } = useNexus();
  const [st, setSt] = useState<VoiceStatus | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [piper, setPiper] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const load = () => api.voiceStatus().then(setSt).catch(() => {});
  useEffect(() => { load(); listVoices().then(setVoices); api.ttsStatus().then((t) => setPiper(t.available ? t.voices : [])).catch(() => {}); }, []);
  useEvent<{ type: string; done?: number; total?: number; finished?: boolean }>("nexus://voice", (e) => {
    if (e.type === "download" && e.total) setProgress(e.finished ? null : { done: e.done ?? 0, total: e.total });
    if (e.type === "status") { setProgress(null); load(); }
  });
  const prefLang = lang === "en" ? "en" : "fr";
  const shown = voices.filter((v) => v.lang.toLowerCase().startsWith(prefLang));
  const model = st?.models.find((m) => m.id === s.voiceModel);
  return (
    <Card title={L("Voix", "Voice")}>
      <Row label={L("Activer la voix", "Enable voice")} hint={L("Désactivée par défaut. Même activée, le micro ne s'ouvre que quand vous cliquez sur le micro, maintenez le raccourci ou lancez une conversation vocale. Votre voix est transcrite sur ce PC ; seul le texte est envoyé à l'IA.",
        "Off by default. Even when on, the microphone only opens when you click the mic, hold the shortcut or start a voice conversation. Your voice is transcribed on this PC; only the text is sent to the AI.")}>
        <Toggle checked={s.voiceEnabled} onChange={(v) => set("voiceEnabled", v)} />
      </Row>
      <Row label={L("Microphone", "Microphone")} hint={L("Choisissez votre vrai micro si Windows utilise un micro virtuel par défaut.", "Pick your real microphone if Windows defaults to a virtual one.")}>
        <Select value={s.voiceDevice} onChange={(e) => set("voiceDevice", e.target.value)} className="max-w-[340px]">
          <option value="">{L("Micro par défaut de Windows", "Windows default microphone")}</option>
          {(st?.devices ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
      </Row>
      <MicTest enabled={s.voiceEnabled} />
      <Row label={L("Modèle de reconnaissance (Whisper, local)", "Recognition model (Whisper, local)")} hint={L("« small » comprend mieux le français ; « base » est plus léger et plus rapide.", "\"small\" understands French better; \"base\" is lighter and faster.")}>
        <Select value={s.voiceModel} onChange={(e) => set("voiceModel", e.target.value)}>
          {(st?.models ?? [{ id: "small", sizeMB: 488, ready: false }, { id: "base", sizeMB: 148, ready: false }]).map((m) => (
            <option key={m.id} value={m.id}>{m.id} · {m.sizeMB} Mo {m.ready ? "✓" : ""}</option>
          ))}
        </Select>
        {model?.ready ? <span className="text-[11.5px] text-ok">{L("Téléchargé", "Downloaded")}</span> : (
          <Button size="sm" disabled={!!progress || st?.downloading} onClick={() => run(api.voiceDownloadModel(s.voiceModel), L("Modèle vocal téléchargé", "Voice model downloaded")).then(load)}>
            {progress ? `${Math.round((progress.done / progress.total) * 100)} %` : L(`Télécharger (${model?.sizeMB ?? "?"} Mo)`, `Download (${model?.sizeMB ?? "?"} MB)`)}
          </Button>
        )}
      </Row>
      <Row label={L("Appuyer pour parler (raccourci global)", "Push-to-talk (global shortcut)")} hint={L("Maintenez pour parler, relâchez pour envoyer.", "Hold to speak, release to send.")}>
        <Select value={s.voiceShortcut} onChange={(e) => set("voiceShortcut", e.target.value)}>
          {["Ctrl+Alt+V", "Ctrl+Shift+V", "Ctrl+Alt+M"].map((k) => <option key={k} value={k}>{k}</option>)}
          <option value="off">{L("Aucun", "None")}</option>
        </Select>
      </Row>
      <Row label={L("Lire les réponses à voix haute", "Read answers aloud")} hint={L("Pour les demandes faites à la voix.", "For spoken requests.")}>
        <Toggle checked={s.voiceSpeakReplies} onChange={(v) => set("voiceSpeakReplies", v)} />
      </Row>
      <Row label={L("Voix", "Voice")}>
        <Select value={s.voiceName} onChange={(e) => set("voiceName", e.target.value)}>
          <option value="">{L("Par défaut", "Default")}</option>
          {piper.length > 0 && (
            <optgroup label={L("Voix naturelles (sur ce PC)", "Natural voices (on this PC)")}>
              {piper.map((id) => <option key={id} value={PIPER_PREFIX + id}>{PIPER_NAMES[id] ?? id}</option>)}
            </optgroup>
          )}
          <optgroup label={L("Voix Windows", "Windows voices")}>
            {shown.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </optgroup>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => speak(L("Bonjour, je suis NEXUS. Voici ma voix.", "Hello, I am NEXUS. This is my voice."), { voiceName: s.voiceName, rate: s.voiceRate, volume: s.voiceVolume, muted: false, lang: prefLang })}>{L("Tester la voix", "Test voice")}</Button>
      </Row>
      <Row label={L("Volume de la voix", "Voice volume")} hint={L("Volume des réponses parlées de NEXUS (indépendant du volume Windows).", "Volume of NEXUS's spoken replies (independent of the Windows volume).")}>
        <input type="range" min={0} max={100} step={1} value={s.voiceVolume} disabled={s.voiceMuted} onChange={(e) => set("voiceVolume", Number(e.target.value))} aria-label={L("Volume", "Volume")} />
        <span className="w-10 text-right font-mono text-[11.5px] text-mute">{s.voiceVolume}</span>
        <label className="flex items-center gap-1.5 text-[12px] text-mute"><Toggle checked={s.voiceMuted} onChange={(v) => set("voiceMuted", v)} />{L("Muet", "Mute")}</label>
      </Row>
      <Row label={L("Vitesse de lecture", "Speaking rate")}>
        <input type="range" min={0.6} max={1.6} step={0.1} value={s.voiceRate} onChange={(e) => set("voiceRate", Number(e.target.value))} aria-label={L("Vitesse", "Rate")} />
        <span className="w-10 text-right font-mono text-[11.5px] text-mute">{s.voiceRate.toFixed(1)}×</span>
      </Row>
      {voices.length === 0 && <div className="pt-2 text-[11.5px] text-warn">{L("Aucune voix Windows n'est disponible pour la lecture à voix haute.", "No Windows voice is available for reading aloud.")}</div>}
      <div className="pt-3 text-[11.5px] text-dim">{L("STOP NEXUS ferme aussi le micro et coupe la voix.", "STOP NEXUS also closes the microphone and silences speech.")}</div>
    </Card>
  );
}

function CompanionSettings({ s, set }: { s: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  const L = useL();
  const { lang } = useNexus();
  const [registered, setRegistered] = useState<boolean | null>(null);
  useEffect(() => { api.startupStatus().then(setRegistered).catch(() => {}); }, [s.startWithWindows]);
  return (
    <Card title="Companion">
      <Row label={L("Activer le Companion", "Enable the Companion")} hint={L("Petite fenêtre flottante reliée au même agent, aux mêmes permissions et au même journal.", "Small floating window connected to the same agent, permissions and log.")}>
        <Toggle checked={s.companionEnabled} onChange={(v) => set("companionEnabled", v)} />
      </Row>
      <Row label={L("Afficher au démarrage de NEXUS", "Show when NEXUS starts")}><Toggle checked={s.companionShowOnStart} onChange={(v) => set("companionShowOnStart", v)} /></Row>
      <Row label={L("Toujours au premier plan", "Always on top")}><Toggle checked={s.companionAlwaysOnTop} onChange={(v) => set("companionAlwaysOnTop", v)} /></Row>
      <Row label={L("Raccourci clavier global", "Global keyboard shortcut")} hint={L("Affiche ou masque le Companion depuis n'importe où.", "Shows or hides the Companion from anywhere.")}>
        <Select value={s.companionShortcut} onChange={(e) => set("companionShortcut", e.target.value)}>
          {["Ctrl+Alt+N", "Ctrl+Alt+Space", "Ctrl+Shift+Space", "Ctrl+Alt+J"].map((k) => <option key={k} value={k}>{k}</option>)}
          <option value="off">{L("Aucun", "None")}</option>
        </Select>
      </Row>
      <Row label={L("Animations du personnage", "Character animations")} hint={L("« Réduites » respecte aussi le réglage système de réduction des animations.", "The system reduced-motion setting is always respected.")}>
        <Select value={s.companionAnimation} onChange={(e) => set("companionAnimation", e.target.value as Settings["companionAnimation"])}>
          <option value="full">{L("Complètes", "Full")}</option><option value="subtle">{L("Réduites", "Subtle")}</option><option value="off">{L("Désactivées", "Off")}</option>
        </Select>
      </Row>
      <Row label={L("Couleur des yeux", "Eye colour")}>
        <Select value={s.companionAccent} onChange={(e) => set("companionAccent", e.target.value)}>
          <option value="sky">{L("Bleu ciel", "Sky")}</option><option value="teal">{L("Turquoise", "Teal")}</option><option value="violet">Violet</option>
        </Select>
      </Row>
      <Row label={L("Effets sonores", "Sound effects")} hint={L("Petits sons de succès, d'erreur et de demande d'accord. Aucun micro n'est utilisé.", "Short success, error and approval sounds. No microphone is used.")}>
        <Toggle checked={s.companionSounds} onChange={(v) => set("companionSounds", v)} />
      </Row>
      <Row label={L("Fermer = garder NEXUS en arrière-plan", "Close = keep NEXUS in the background")} hint={L("La croix de la fenêtre principale la cache ; NEXUS reste dans la zone de notification (icône près de l'horloge). « Quitter NEXUS » dans ce menu ferme vraiment.", "The main window's close button hides it; NEXUS stays in the notification area (icon near the clock). \"Quit NEXUS\" in that menu really exits.")}>
        <Toggle checked={s.closeToTray} onChange={(v) => set("closeToTray", v)} />
      </Row>
      <Row label={L("Démarrer réduit", "Start minimized")} hint={L("Au lancement, seulement l'icône de notification et le Companion, sans la fenêtre principale.", "On launch, only the notification icon and the Companion, without the main window.")}>
        <Toggle checked={s.startMinimized} onChange={(v) => set("startMinimized", v)} />
      </Row>
      <Row label={L("Démarrer avec Windows", "Start with Windows")} hint={L(`Ajoute NEXUS au démarrage de votre session (registre utilisateur). État actuel : ${registered == null ? "…" : registered ? "activé" : "désactivé"}.`, `Adds NEXUS to your session startup (user registry). Current state: ${registered == null ? "…" : registered ? "enabled" : "disabled"}.`)}>
        <Toggle checked={s.startWithWindows} onChange={(v) => set("startWithWindows", v)} />
      </Row>
      <Row label={L("Position", "Position")} hint={L("Déplacez le Companion en le faisant glisser ; sa position est mémorisée.", "Drag the Companion to move it; its position is remembered.")}>
        <Button size="sm" variant="ghost" onClick={() => api.companionShow()}>{L("Afficher", "Show")}</Button>
      </Row>
      <div className="pt-3">
        <div className="mb-2 text-[13px] font-medium">{L("Actions rapides de la barre", "Toolbar quick actions")}</div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => {
            const on = s.companionActions.includes(q.id);
            return (
              <button key={q.id} onClick={() => set("companionActions", on ? s.companionActions.filter((x) => x !== q.id) : [...s.companionActions, q.id])}
                className={cx("rounded-lg border px-2.5 py-1 text-[12px]", on ? "border-sky/40 bg-sky/10 text-fg" : "border-line text-mute hover:text-fg")}>
                {lang === "en" ? q.en : q.fr}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-dim">{L("STOP NEXUS est toujours présent dans la barre.", "STOP NEXUS is always in the toolbar.")}</div>
      </div>
    </Card>
  );
}

const SECTIONS = ["ai", "security", "control", "companion", "voice", "browser", "calendar", "memory", "appearance", "diagnostics"] as const;
type Section = (typeof SECTIONS)[number];

export default function SettingsPage() {
  const { settings, reloadSettings, run, refresh } = useNexus();
  const L = useL();
  const [s, setS] = useState<Settings | null>(settings);
  const [sec, setSec] = useState<Section>("ai");
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [newMem, setNewMem] = useState("");
  const [browsers, setBrowsers] = useState<AppRow[]>([]);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [runs, setRuns] = useState<ToolRun[]>([]);

  useEffect(() => { setS(settings); }, [settings]);
  const loadSecrets = () => api.secretStatus().then(setSecrets).catch(() => {});
  const loadMemory = () => api.listMemory().then(setMemory).catch(() => {});
  useEffect(() => {
    loadSecrets();
    loadMemory();
    api.listApps().then((a) => setBrowsers(a.filter((x) => /opera|chrome|edge|firefox|brave|arc|vivaldi|browser|navigateur/i.test(x.name) && x.exePath))).catch(() => {});
    api.listTools().then(setTools).catch(() => {});
    api.listToolRuns(200).then(setRuns).catch(() => {});
  }, []);
  useEvent("nexus://memory", loadMemory);

  if (!s) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const save = async () => { await run(api.saveSettings(s), L("Paramètres enregistrés", "Settings saved")); reloadSettings(); refresh(); };

  const names: Record<Section, string> = {
    ai: "IA", security: L("Sécurité", "Security"), control: L("Contrôle", "Control"), companion: "Companion", voice: L("Voix", "Voice"), browser: L("Navigateur", "Browser"),
    calendar: L("Calendrier", "Calendar"), memory: L("Mémoire", "Memory"), appearance: L("Apparence", "Appearance"), diagnostics: L("Diagnostics", "Diagnostics"),
  };
  const keyName = s.aiProvider === "openai" ? "openai_api_key" : "anthropic_api_key";

  return (
    <div>
      <PageHeader title={L("Paramètres", "Settings")}>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!dirty} onClick={save}>{L("Enregistrer", "Save")}</Button>
      </PageHeader>
      <div className="grid grid-cols-12 gap-5">
        <nav className="col-span-12 flex gap-1 overflow-x-auto md:col-span-3 md:flex-col xl:col-span-2">
          {SECTIONS.map((x) => (
            <button key={x} onClick={() => setSec(x)} className={cx("rounded-lg px-3 py-2 text-left text-[13px] whitespace-nowrap", sec === x ? "bg-white/[0.07] text-fg" : "text-mute hover:bg-white/[0.035] hover:text-fg")}>{names[x]}</button>
          ))}
        </nav>
        <div className="col-span-12 space-y-4 md:col-span-9 xl:col-span-10">
          {sec === "ai" && (
            <Card title={L("Fournisseur d'IA", "AI provider")}>
              <Row label={L("Fournisseur", "Provider")} hint={L("L'IA ne fait que demander des outils ; le backend NEXUS décide de leur exécution.", "The AI can only request tools; the NEXUS backend decides whether they run.")}>
                <Select value={s.aiProvider} onChange={(e) => set("aiProvider", e.target.value)}>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI — {L("non implémenté", "not implemented")}</option>
                </Select>
              </Row>
              {s.aiProvider === "anthropic" ? (
                <>
                  <Row label={L("Modèle", "Model")} hint={L("Identifiant exact du modèle Anthropic.", "Exact Anthropic model ID.")}>
                    <Input className="w-56 font-mono" value={s.anthropicModel} onChange={(e) => set("anthropicModel", e.target.value)} list="models" />
                    <datalist id="models">
                      {["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5-1"].map((m) => <option key={m} value={m} />)}
                    </datalist>
                  </Row>
                  <Row label={L("Effort", "Effort")} hint={L("Plus d'effort = réponses plus réfléchies mais plus lentes et plus coûteuses.", "More effort = more thorough but slower and costlier answers.")}>
                    <Select value={s.effort} onChange={(e) => set("effort", e.target.value)}>
                      {["low", "medium", "high", "xhigh", "max"].map((x) => <option key={x} value={x}>{x}</option>)}
                    </Select>
                  </Row>
                </>
              ) : (
                <div className="py-3"><NotImplemented title="OpenAI" phase="Phase 2+">{L("L'interface fournisseur est prête, mais l'adaptateur OpenAI n'est pas encore écrit. Aucune requête n'est simulée.", "The provider interface is ready but the OpenAI adapter is not written yet. No request is simulated.")}</NotImplemented></div>
              )}
              <Row label={L("Clé API", "API key")} hint={L("Stockée dans le Gestionnaire d'identifiants Windows. Jamais affichée ni envoyée à l'interface.", "Stored in Windows Credential Manager. Never displayed or sent back to the UI.")}>
                <span className={cx("inline-flex items-center gap-1 text-[11.5px]", secrets[keyName] ? "text-ok" : "text-warn")}>
                  <KeyRound className="h-3.5 w-3.5" />{secrets[keyName] ? L("Configurée", "Configured") : L("Absente", "Missing")}
                </span>
              </Row>
              <div className="flex flex-wrap gap-2 pb-3">
                <Input type="password" autoComplete="off" className="max-w-md font-mono" placeholder={s.aiProvider === "anthropic" ? "sk-ant-…" : "sk-…"} value={key} onChange={(e) => setKey(e.target.value)} />
                <Button disabled={!key.trim()} onClick={async () => { await run(api.setSecret(keyName, key), L("Clé enregistrée", "Key saved")); setKey(""); loadSecrets(); refresh(); }}>{L("Enregistrer la clé", "Save key")}</Button>
                {secrets[keyName] && <ConfirmButton variant="ghost" confirmLabel={L("Confirmer", "Confirm")} onConfirm={async () => { await run(api.clearSecret(keyName)); loadSecrets(); refresh(); }}>{L("Supprimer", "Remove")}</ConfirmButton>}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                <Button icon={<Plug className="h-4 w-4" />} disabled={testing || dirty} onClick={async () => { setTesting(true); setTestResult(null); const r = await run(api.testAi()); setTestResult(r ?? null); setTesting(false); }}>
                  {testing ? L("Test…", "Testing…") : L("Tester la connexion", "Test connection")}
                </Button>
                {dirty && <span className="text-[11.5px] text-warn">{L("Enregistrez d'abord.", "Save first.")}</span>}
                {testResult && <span className="text-[12px] text-ok">{testResult}</span>}
              </div>
            </Card>
          )}

          {sec === "security" && (
            <Card title={L("Sécurité", "Security")}>
              <Row label={L("Confirmer les actions MEDIUM", "Confirm MEDIUM actions")} hint={L("Clics, frappe, écriture de fichiers… Les actions HIGH demandent toujours confirmation par défaut.", "Clicks, typing, file writes… HIGH actions always ask by default.")}>
                <Toggle checked={s.mediumRequiresApproval} onChange={(v) => set("mediumRequiresApproval", v)} />
              </Row>
              <Row label={L("Mode au démarrage", "Default mode")}>
                <Select value={s.defaultMode} onChange={(e) => set("defaultMode", e.target.value as Settings["defaultMode"])}>
                  <option value="MANUAL">MANUAL</option><option value="AI">AI</option><option value="COPILOT">CO-PILOT</option>
                </Select>
              </Row>
              <Row label={L("Arrêt d'urgence global", "Global emergency stop")} hint={L("Fonctionne même quand NEXUS n'a pas le focus.", "Works even when NEXUS is not focused.")}>
                <span className="rounded-md border border-line bg-black/25 px-2 py-1 font-mono text-[12px]">Ctrl + Alt + Backspace</span>
              </Row>
              <div className="pt-2 text-[11.5px] text-mute">{L("Permissions, applications et dossiers autorisés se règlent dans la page Permissions.", "Permissions, applications and authorized folders are managed on the Permissions page.")}</div>
            </Card>
          )}

          {sec === "control" && (
            <Card title={L("Contrôle", "Control")}>
              <Row label={L("Largeur max. des captures envoyées à l'IA", "Max width of screenshots sent to the AI")} hint={L("Plus grand = plus précis mais plus de jetons.", "Larger = more precise but more tokens.")}>
                <Select value={s.aiScreenshotMaxWidth} onChange={(e) => set("aiScreenshotMaxWidth", Number(e.target.value))}>
                  {[1024, 1280, 1366, 1600, 1920].map((w) => <option key={w} value={w}>{w}px</option>)}
                </Select>
              </Row>
              <Row label={L("Qualité JPEG du flux", "Stream JPEG quality")}>
                <Input type="number" min={30} max={95} className="w-24" value={s.streamQuality} onChange={(e) => set("streamQuality", Number(e.target.value))} />
              </Row>
            </Card>
          )}

          {sec === "companion" && <CompanionSettings s={s} set={set} />}
          {sec === "voice" && <VoiceSettings s={s} set={set} />}

          {sec === "browser" && (
            <Card title={L("Navigateur", "Browser")}>
              <Row label={L("Navigateur par défaut de NEXUS", "NEXUS default browser")}>
                <Select value={s.defaultBrowser} onChange={(e) => set("defaultBrowser", e.target.value)}>
                  <option value="system">{L("Navigateur Windows par défaut", "Windows default browser")}</option>
                  {browsers.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                </Select>
              </Row>
              <Row label={L("Moteur de recherche", "Search engine")}>
                <Select value={s.searchEngine} onChange={(e) => set("searchEngine", e.target.value)}>
                  <option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option>
                </Select>
              </Row>
            </Card>
          )}

          {sec === "calendar" && (
            <NotImplemented title="Microsoft Calendar" phase="Phase 8">
              {L("L'intégration Microsoft Graph (connexion explicite, lecture et écriture d'événements) n'est pas encore construite. Elle nécessitera l'ID client d'une application enregistrée dans Microsoft Entra.",
                 "The Microsoft Graph integration (explicit sign-in, reading and writing events) is not built yet. It will require the client ID of an app registered in Microsoft Entra.")}
            </NotImplemented>
          )}

          {sec === "memory" && (
            <Card title={L("Mémoire", "Memory")} action={memory.length > 0 && <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} confirmLabel={L("Tout effacer ?", "Erase all?")} onConfirm={async () => { await run(api.clearMemory()); loadMemory(); }}>{L("Tout effacer", "Erase all")}</ConfirmButton>}>
              <Row label={L("Mémoire activée", "Memory enabled")} hint={L("NEXUS peut retenir vos préférences durables. Les secrets sont refusés automatiquement.", "NEXUS may remember durable preferences. Secrets are refused automatically.")}>
                <Toggle checked={s.memoryEnabled} onChange={(v) => set("memoryEnabled", v)} />
              </Row>
              <form className="my-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(api.addMemory(newMem))) { setNewMem(""); loadMemory(); } }}>
                <Input placeholder={L("Ajouter un souvenir, ex. « Je préfère Opera GX »", "Add a memory, e.g. \"I prefer Opera GX\"")} value={newMem} onChange={(e) => setNewMem(e.target.value)} />
                <Button type="submit" disabled={!newMem.trim()}>{L("Ajouter", "Add")}</Button>
              </form>
              {memory.length === 0 ? <Empty icon={<Brain className="h-6 w-6" />} title={L("Aucun souvenir", "No memories")} /> : (
                <ul className="divide-y divide-line">
                  {memory.map((m) => (
                    <li key={m.id} className="flex items-start gap-3 py-2">
                      <span className="mt-0.5 font-mono text-[10.5px] text-dim">#{m.id}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]">{m.content}</div>
                        <div className="text-[10.5px] text-dim">{m.projectName ? `${L("Projet", "Project")} ${m.projectName} · ` : ""}{fmtTime(m.createdAt, true)}</div>
                      </div>
                      <button className="rounded p-1 text-dim hover:text-bad" onClick={async () => { await run(api.deleteMemory(m.id)); loadMemory(); }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {sec === "appearance" && (
            <Card title={L("Apparence", "Appearance")}>
              <Row label={L("Langue", "Language")}>
                <Select value={s.language} onChange={(e) => set("language", e.target.value)}>
                  <option value="fr">Français</option><option value="en">English</option>
                </Select>
              </Row>
              <Row label={L("Animations", "Animations")}><Toggle checked={s.animations} onChange={(v) => set("animations", v)} /></Row>
              <Row label={L("Thème", "Theme")} hint={L("NEXUS n'a qu'un thème sombre pour l'instant.", "NEXUS only has a dark theme for now.")}><span className="text-[12px] text-mute">Dark</span></Row>
            </Card>
          )}

          {sec === "diagnostics" && (
            <>
              <Card title={L(`Outils enregistrés (${tools.length})`, `Registered tools (${tools.length})`)} pad={false}>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-left text-[12px]">
                    <tbody className="divide-y divide-line">
                      {tools.map((t) => (
                        <tr key={t.name}>
                          <td className="px-4 py-2 font-mono text-[11.5px]">{t.name}</td>
                          <td className="px-2 py-2 font-mono text-[10.5px] text-mute">{t.scope}</td>
                          <td className="px-2 py-2"><RiskBadge risk={t.risk} /></td>
                          <td className="px-4 py-2 text-[11px] text-mute">{t.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title={L("Appels d'outils récents", "Recent tool calls")} pad={false}>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="text-[10px] uppercase tracking-[0.12em] text-dim">
                      <tr className="border-b border-line"><th className="px-4 py-2">{L("Heure", "Time")}</th><th className="px-2 py-2">{L("Outil", "Tool")}</th><th className="px-2 py-2">{L("Décision", "Decision")}</th><th className="px-2 py-2">{L("Durée", "Duration")}</th><th className="px-4 py-2">{L("Statut", "Status")}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {runs.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-1.5 font-mono text-[10.5px] text-dim">{fmtTime(r.startedAt, true)}</td>
                          <td className="px-2 py-1.5 font-mono text-[11px]">{r.tool}</td>
                          <td className="px-2 py-1.5 text-[11px] text-mute">{r.decision ?? "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-[11px] text-mute">{r.durationMs != null ? `${r.durationMs} ms` : "—"}</td>
                          <td className="px-4 py-1.5"><StatusPill status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {runs.length === 0 && <Empty title={L("Aucun appel", "No calls yet")} />}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
