import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Construction, X } from "lucide-react";
import type { AgentStatus, Risk } from "../lib/api";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ className, children, title, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("glass flex flex-col min-w-0", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">{title}</h3>
          {action}
        </header>
      )}
      <div className={cx("min-h-0 flex-1", pad && "px-4 pb-4", !title && !action && pad && "pt-4")}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "ghost" | "danger" | "subtle" | "ok";
export function Button({ variant = "subtle", size = "md", className, icon, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode }) {
  const v: Record<Variant, string> = {
    primary: "bg-gradient-to-r from-sky/90 to-violet/90 text-ink font-semibold hover:brightness-110 shadow-[0_6px_24px_-8px_rgb(139_125_255/0.6)]",
    subtle: "bg-panel-2 border border-line text-fg hover:bg-white/10",
    ghost: "text-mute hover:text-fg hover:bg-white/5",
    danger: "bg-bad/15 border border-bad/40 text-bad hover:bg-bad/25",
    ok: "bg-ok/15 border border-ok/40 text-ok hover:bg-ok/25",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
        v[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-9 w-full rounded-lg bg-black/25 border border-line px-3 text-[13px] text-fg placeholder:text-dim outline-none focus:border-sky/50 focus:bg-black/35 transition-colors",
        props.className,
      )}
    />
  );
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx("h-9 rounded-lg bg-black/25 border border-line px-2.5 text-[13px] text-fg outline-none focus:border-sky/50", props.className)}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-sky/80" : "bg-white/12")}>
      <span className={cx("absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

const riskStyle: Record<Risk, string> = {
  LOW: "text-ok border-ok/30 bg-ok/10",
  MEDIUM: "text-warn border-warn/30 bg-warn/10",
  HIGH: "text-bad border-bad/40 bg-bad/10",
};
export function RiskBadge({ risk }: { risk: Risk | string | null | undefined }) {
  if (!risk) return null;
  const r = (risk as Risk) in riskStyle ? (risk as Risk) : "LOW";
  return <span className={cx("inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold tracking-wider", riskStyle[r])}>{risk}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    ["COMPLETED", "OK", "PASSED"].includes(s) ? "text-ok bg-ok/10 border-ok/25"
    : ["FAILED", "ERROR", "DENIED"].includes(s) ? "text-bad bg-bad/10 border-bad/30"
    : ["CANCELLED", "STOPPED"].includes(s) ? "text-mute bg-white/5 border-line"
    : ["WAITING_PERMISSION", "WAITING_USER", "PENDING", "UNVERIFIED"].includes(s) ? "text-warn bg-warn/10 border-warn/30"
    : "text-sky bg-sky/10 border-sky/25";
  return <span className={cx("inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold tracking-wide whitespace-nowrap", tone)}>{s.replace(/_/g, " ")}</span>;
}

export const statusMeta: Record<AgentStatus, { fr: string; en: string; color: string; busy: boolean }> = {
  IDLE: { fr: "En veille", en: "Idle", color: "#8d96a8", busy: false },
  THINKING: { fr: "Réflexion", en: "Thinking", color: "#8fd3ff", busy: true },
  PLANNING: { fr: "Planification", en: "Planning", color: "#8b7dff", busy: true },
  WAITING_PERMISSION: { fr: "Autorisation requise", en: "Waiting permission", color: "#f5c451", busy: true },
  EXECUTING: { fr: "Exécution", en: "Executing", color: "#8fd3ff", busy: true },
  VERIFYING: { fr: "Vérification", en: "Verifying", color: "#8b7dff", busy: true },
  COMPLETED: { fr: "Terminé", en: "Completed", color: "#4ade9b", busy: false },
  ERROR: { fr: "Erreur", en: "Error", color: "#ff6b7a", busy: false },
  STOPPED: { fr: "Arrêté", en: "Stopped", color: "#ff6b7a", busy: false },
};

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={cx("inline-block h-2 w-2 rounded-full", pulse && "pulse")} style={{ background: color, ["--ring" as string]: color + "88" }} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-mute">
      {icon && <div className="text-dim">{icon}</div>}
      <div className="text-[13px] font-medium text-fg/80">{title}</div>
      {children && <div className="max-w-md text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

/** Honest marker for features that do not work yet. */
export function NotImplemented({ title, phase, children }: { title: string; phase: string; children: ReactNode }) {
  return (
    <div className="glass flex items-start gap-3 border-warn/25 bg-warn/[0.04] p-4">
      <Construction className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">{title}</span>
          <span className="rounded-md border border-warn/30 bg-warn/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-warn">Not implemented · {phase}</span>
        </div>
        <div className="mt-1 text-xs leading-relaxed text-mute">{children}</div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={cx("glass fade-up flex max-h-[85vh] w-full flex-col bg-ink-2/95", wide ? "max-w-3xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-mute hover:bg-white/5 hover:text-fg" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-mute">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function fmtTime(iso: string | null | undefined, withDate = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(undefined, withDate || !today
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtBytes(n: number | null | undefined) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function toolLabel(name: string) {
  return name.includes(".") ? name : name.replace("_", ".");
}

/** Two-step button for destructive actions (no native confirm() dialogs). */
export function ConfirmButton({ onConfirm, children, confirmLabel, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { onConfirm: () => void; confirmLabel: string; variant?: Variant; size?: "sm" | "md"; icon?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button {...rest} variant={armed ? "danger" : rest.variant} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirmLabel : children}
    </Button>
  );
}
