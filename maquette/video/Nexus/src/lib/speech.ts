// Spoken replies: natural local Piper voices ("piper:<id>", synthesised by the
// backend) or the Windows voices available to WebView2 (speechSynthesis).
import { api } from "./api";

export const PIPER_PREFIX = "piper:";
let audio: HTMLAudioElement | null = null;
let speakSeq = 0;

/** Display names for the Piper voices NEXUS knows; other ids are shown as is. */
export const PIPER_NAMES: Record<string, string> = {
  "fr_FR-siwis-medium": "Siwis — voix naturelle (féminine)",
  "fr_FR-tom-medium": "Tom — voix naturelle (masculine)",
  "fr_FR-upmc-medium": "UPMC — voix naturelle",
};

export function speechAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechAvailable()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Strips Markdown so the voice doesn't read symbols aloud. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (bloc de code) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[✅⚠️❌✓]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stopSpeaking() {
  speakSeq += 1;
  if (audio) { audio.pause(); audio = null; }
  if (speechAvailable()) speechSynthesis.cancel();
}

async function speakPiper(text: string, voice: string, rate: number, volume: number): Promise<void> {
  const seq = ++speakSeq;
  // Sentence by sentence: the first one starts playing while the next is synthesised.
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
  let next: Promise<string> | null = api.ttsSpeak(parts[0]!, voice, rate);
  for (let i = 0; i < parts.length; i++) {
    const url = await next!;
    next = i + 1 < parts.length ? api.ttsSpeak(parts[i + 1]!, voice, rate) : null;
    if (seq !== speakSeq) return;
    await new Promise<void>((resolve) => {
      const a = new Audio(url);
      a.volume = volume;
      audio = a;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.onpause = () => resolve();
      a.play().catch(() => resolve());
    });
    if (seq !== speakSeq) return;
  }
}

/** `volume` 0-100 (real output volume of the voice); muted = nothing is played. */
export async function speak(text: string, opts: { voiceName?: string; rate?: number; volume?: number; muted?: boolean; lang: "fr" | "en" }): Promise<void> {
  if (!speechAvailable()) return;
  const t = plainText(text).slice(0, 2000);
  if (!t || opts.muted) return;
  const volume = Math.min(1, Math.max(0, (opts.volume ?? 100) / 100));
  stopSpeaking();
  if (opts.voiceName?.startsWith(PIPER_PREFIX)) {
    try {
      await speakPiper(t, opts.voiceName.slice(PIPER_PREFIX.length), opts.rate ?? 1, volume);
      return;
    } catch {
      // Piper unavailable: fall back to a Windows voice below.
    }
  }
  const voices = await listVoices();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = opts.lang === "en" ? "en-US" : "fr-FR";
  u.rate = opts.rate ?? 1;
  u.volume = volume;
  u.voice = voices.find((v) => v.name === opts.voiceName) ?? voices.find((v) => v.lang.toLowerCase().startsWith(opts.lang)) ?? null;
  return new Promise((resolve) => {
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/**
 * Whisper output to ignore: nothing but punctuation, or the phrases it is known
 * to "hear" in silence/noise (subtitle credits…). Returns "" in that case.
 */
export function cleanTranscript(text: string): string {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  const low = t.toLowerCase();
  const ghosts = ["sous-titres réalisés par", "sous-titrage", "amara.org", "merci d'avoir regardé", "thanks for watching", "abonnez-vous", "subscribe"];
  if (ghosts.some((g) => low.includes(g))) return "";
  return t;
}

/** Phrases that end the hands-free conversation. */
export function isExitPhrase(text: string): boolean {
  const t = text.toLowerCase().replace(/[.!?,]/g, "").trim();
  return ["stop", "arrête", "arrete", "fin de conversation", "merci c'est tout", "c'est tout", "au revoir", "that's all", "goodbye", "stop listening"].some((p) => t === p || t.endsWith(p));
}
