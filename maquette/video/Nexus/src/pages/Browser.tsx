import { Globe, Search } from "lucide-react";
import { useState } from "react";
import { Button, Card, Input, NotImplemented, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useL, useNexus } from "../lib/store";

export default function BrowserPage() {
  const { run, settings, go } = useNexus();
  const L = useL();
  const [url, setUrl] = useState("");
  const [q, setQ] = useState("");
  return (
    <div className="space-y-4">
      <PageHeader title={L("Navigateur", "Browser")} subtitle={`${L("Navigateur utilisé", "Browser used")}: ${settings?.defaultBrowser === "system" ? L("par défaut de Windows", "Windows default") : settings?.defaultBrowser} · ${L("moteur", "engine")}: ${settings?.searchEngine}`}>
        <Button variant="ghost" onClick={() => go("settings")}>{L("Changer", "Change")}</Button>
      </PageHeader>
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-6" title={L("Ouvrir un site", "Open a website")}>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) run(api.openUrl(url), L("Ouvert", "Opened")).then(() => setUrl("")); }}>
            <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" icon={<Globe className="h-4 w-4" />} disabled={!url.trim()}>{L("Ouvrir", "Open")}</Button>
          </form>
        </Card>
        <Card className="col-span-12 lg:col-span-6" title={L("Recherche web", "Web search")}>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(api.webSearch(q), L("Recherche ouverte", "Search opened")).then(() => setQ("")); }}>
            <Input placeholder={L("Rechercher…", "Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" icon={<Search className="h-4 w-4" />} disabled={!q.trim()}>{L("Chercher", "Search")}</Button>
          </form>
        </Card>
      </div>
      <Card title={L("Capacités de l'agent", "Agent capabilities")}>
        <ul className="space-y-1.5 text-[12.5px]">
          <li><span className="font-mono text-ok">browser.open</span> · <span className="font-mono text-ok">browser.search</span> — {L("ouvre des pages dans votre navigateur.", "open pages in your browser.")}</li>
          <li><span className="font-mono text-ok">browser.read</span> — {L("télécharge une page publique et en extrait le texte, traité comme contenu non fiable (protection contre l'injection de prompt).", "downloads a public page and extracts its text, treated as untrusted content (prompt-injection protection).")}</li>
          <li><span className="font-mono text-ok">desktop.*</span> — {L("NEXUS peut aussi piloter le navigateur visuellement (captures, clics, frappe).", "NEXUS can also drive the browser visually (screenshots, clicks, typing).")}</li>
        </ul>
      </Card>
      <NotImplemented title={L("Pilote d'automatisation du navigateur (DOM)", "Browser automation driver (DOM)")} phase="Phase 7">
        {L("Naviguer, cliquer et taper directement dans le DOM d'une page via un profil de navigateur isolé (Chrome DevTools Protocol) n'est pas encore construit.",
           "Navigating, clicking and typing directly in a page's DOM through an isolated browser profile (Chrome DevTools Protocol) is not built yet.")}
      </NotImplemented>
    </div>
  );
}
