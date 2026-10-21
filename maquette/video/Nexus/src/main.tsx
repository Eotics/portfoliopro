import { getCurrentWindow } from "@tauri-apps/api/window";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import CompanionApp from "./companion/CompanionApp";
import { NexusProvider } from "./lib/store";
import "./styles.css";

// Both windows load the same bundle; the window label decides which UI to render.
let label = "main";
try {
  label = getCurrentWindow().label;
} catch {
  // Not running inside Tauri (plain browser): render the main UI.
}
const isCompanion = label === "companion";
if (isCompanion) document.documentElement.classList.add("companion");

// No browser context menu in a desktop app (text fields keep copy/paste).
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
});

class CompanionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-2 rounded-2xl border border-bad/40 bg-[#0a0d12] p-4 text-[12px]">
        <div className="font-semibold text-bad">Companion error</div>
        <pre className="mt-1 whitespace-pre-wrap text-mute">{this.state.error.message}</pre>
        <button className="mt-2 rounded-lg border border-line px-2 py-1" onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NexusProvider>{isCompanion ? <CompanionBoundary><CompanionApp /></CompanionBoundary> : <App />}</NexusProvider>
  </StrictMode>,
);
