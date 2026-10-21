import { NotImplemented, PageHeader } from "../components/ui";
import { useL } from "../lib/store";

export default function AutomationsPage() {
  const L = useL();
  return (
    <div className="space-y-4">
      <PageHeader title={L("Automatisations", "Automations")} subtitle={L("Déclencheurs planifiés et au démarrage de Windows.", "Scheduled and Windows-startup triggers.")} />
      <NotImplemented title={L("Moteur d'automatisations", "Automation engine")} phase="Phase 9">
        {L("Les automatisations (« chaque matin à 8 h, ouvre mes applis de travail », « au démarrage, ouvre Opera GX et VS Code ») ne sont pas encore construites. Elles passeront par le même pipeline de permissions, respecteront STOP NEXUS et seront journalisées.",
           "Automations (\"every morning at 8, open my work apps\", \"at startup, open Opera GX and VS Code\") are not built yet. They will go through the same permission pipeline, respect STOP NEXUS and be logged.")}
      </NotImplemented>
    </div>
  );
}
