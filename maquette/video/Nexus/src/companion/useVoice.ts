import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "../lib/api";
import { cleanTranscript, isExitPhrase, speak, stopSpeaking } from "../lib/speech";
import { useEvent, useNexus } from "../lib/store";
import type { useConversation } from "./useConversation";

type Conv = ReturnType<typeof useConversation>;

/**
 * Voice for the Companion. Everything here is user-triggered: the microphone
 * opens only from the mic button, the held push-to-talk shortcut, or the
 * conversation mode the user switched on.
 */
export function useVoice(conv: Conv) {
  const { settings, toast, lang } = useNexus();
  const enabled = !!settings?.voiceEnabled;
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [conversation, setConversation] = useState(false);
  /** Last thing heard from the user / last reply spoken (shown in the pet's bubble). */
  const [heard, setHeard] = useState("");
  const [spoken, setSpoken] = useState("");
  const convMode = useRef(false);
  const awaitingReply = useRef(false);
  convMode.current = conversation;

  const say = useCallback(async (text: string) => {
    if (!settings?.voiceSpeakReplies) return;
    setSpoken(text);
    setSpeaking(true);
    await speak(text, { voiceName: settings.voiceName, rate: settings.voiceRate, volume: settings.voiceVolume, muted: settings.voiceMuted, lang });
    setSpeaking(false);
  }, [settings, lang]);

  const sendTranscript = useCallback(async (raw: string) => {
    const text = cleanTranscript(raw);
    if (!text) {
      if (convMode.current) { toast(lang === "en" ? "I didn't hear anything." : "Je n'ai rien entendu.", "info"); setConversation(false); }
      return;
    }
    if (convMode.current && isExitPhrase(text)) {
      setConversation(false);
      await say(lang === "en" ? "Okay, I stop listening." : "D'accord, j'arrête d'écouter.");
      return;
    }
    setHeard(text);
    awaitingReply.current = true;
    if (!(await conv.send(text, true))) awaitingReply.current = false;
  }, [conv, say, toast, lang]);

  const start = useCallback(async (autoStop = false) => {
    if (!enabled) return;
    stopSpeaking();
    try {
      await api.voiceStart(autoStop);
      setRecording(true);
    } catch (e) {
      toast(errMsg(e), "error");
      setConversation(false);
    }
  }, [enabled, toast]);

  const finish = useCallback(async () => {
    setRecording(false);
    setTranscribing(true);
    try {
      const text = await api.voiceStop();
      setTranscribing(false);
      await sendTranscript(text);
    } catch (e) {
      setTranscribing(false);
      toast(errMsg(e), "error");
      setConversation(false);
    }
  }, [sendTranscript, toast]);

  const toggleMic = useCallback(() => (recording ? finish() : start(false)), [recording, finish, start]);

  const toggleConversation = useCallback(() => {
    if (conversation) {
      setConversation(false);
      stopSpeaking();
      if (recording) { void api.voiceCancel(); setRecording(false); }
    } else {
      setConversation(true);
      void start(true);
    }
  }, [conversation, recording, start]);

  useEvent<{ type: string; level?: number; text?: string; message?: string; open?: boolean }>("nexus://voice", (e) => {
    if (e.type === "level") setLevel(e.level ?? 0);
    if (e.type === "mic") setRecording(!!e.open);
    if (e.type === "autostop" && recording) void finish();
    if (e.type === "ptt") void sendTranscript(e.text ?? "");
    if (e.type === "error") toast(e.message ?? "Voice error", "error");
    if (e.type === "cancel") { setRecording(false); setTranscribing(false); }
    if (e.type === "stop-speaking") { stopSpeaking(); setSpeaking(false); setConversation(false); }
  });

  // When a voice request finishes: speak the answer, then listen again in conversation mode.
  useEvent<{ conversationId: string; type: string }>("nexus://chat", async (e) => {
    if (e.type !== "done" || !awaitingReply.current || e.conversationId !== conv.convId) return;
    awaitingReply.current = false;
    try {
      const c = await api.getConversation(e.conversationId);
      const last = [...c.messages].reverse().find((m) => m.role === "assistant" && m.content.some((b) => b.type === "text"));
      const text = last ? last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n") : "";
      if (text) await say(text);
    } catch { /* nothing to read */ }
    if (convMode.current) void start(true);
  });

  // Turning voice off in Settings closes everything.
  useEffect(() => {
    if (!enabled) { setConversation(false); stopSpeaking(); }
  }, [enabled]);

  return { enabled, recording, transcribing, speaking, level, conversation, heard, spoken, toggleMic, toggleConversation };
}
