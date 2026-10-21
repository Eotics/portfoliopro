import { CalendarDays } from "lucide-react";
import { Card, NotImplemented, PageHeader } from "../components/ui";
import { useL } from "../lib/store";

export default function CalendarPage() {
  const L = useL();
  return (
    <div className="space-y-4">
      <PageHeader title={L("Calendrier", "Calendar")} subtitle="Microsoft Calendar" />
      <NotImplemented title={L("Intégration Microsoft Calendar", "Microsoft Calendar integration")} phase="Phase 8">
        {L("NEXUS n'affiche aucun événement tant que la vraie connexion Microsoft Graph n'existe pas : pas de faux calendrier local. La phase 8 ajoutera la connexion explicite à votre compte Microsoft (code d'appareil OAuth), la lecture, la recherche, la création, la modification et la suppression d'événements, avec vérification après chaque écriture.",
           "NEXUS shows no events until the real Microsoft Graph connection exists: no fake local calendar. Phase 8 adds explicit sign-in to your Microsoft account (OAuth device code), listing, searching, creating, updating and deleting events, with verification after every write.")}
      </NotImplemented>
      <Card>
        <div className="flex items-start gap-3 text-[12.5px] text-mute">
          <CalendarDays className="mt-0.5 h-5 w-5 text-dim" />
          <div>{L("Prérequis : une application enregistrée dans Microsoft Entra (gratuit) avec l'autorisation déléguée Calendars.ReadWrite. NEXUS vous guidera lors de la phase 8.",
                  "Prerequisite: an app registered in Microsoft Entra (free) with the delegated Calendars.ReadWrite permission. NEXUS will guide you in phase 8.")}</div>
        </div>
      </Card>
    </div>
  );
}
