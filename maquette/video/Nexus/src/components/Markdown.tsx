import { Fragment, type ReactNode } from "react";
import { api } from "../lib/api";

// Small, safe Markdown subset (no HTML injection): headings, lists, code, bold, italics, links.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else if (m[4]) {
      const label = t.slice(1, t.indexOf("]"));
      const href = m[5] ?? "";
      // Links open in the user's browser, never inside the NEXUS window.
      out.push(<a key={k} href={href} onClick={(e) => { e.preventDefault(); void api.openUrl(href); }}>{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) body.push(lines[i++] ?? "");
      i++;
      blocks.push(<pre key={k++}>{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<h3 key={k++}>{inline(h[2] ?? "", `h${k}`)}</h3>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i] ?? "")) {
        const content = (lines[i] ?? "").replace(/^\s*([-*•]|\d+[.)])\s+/, "");
        items.push(<li key={i}>{inline(content, `li${i}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k++} className="list-decimal">{items}</ol> : <ul key={k++} className="list-disc">{items}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(```|#{1,3}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i] ?? "")) para.push(lines[i++] ?? "");
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => (
          <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${k}-${j}`)}</Fragment>
        ))}
      </p>,
    );
  }
  return <div className="markdown text-[13.5px] leading-relaxed">{blocks}</div>;
}
