import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { HubsManager } from '@/components/delivery/hubs';

/** /delivery/hubs — nearby hubs / cash-drop + check-in */
export default function DeliveryHubsRoute() {
  return (
    <DeliveryScreenShell title="Hubs" subtitle="Check in & cash drop" flush>
      <HubsManager />
    </DeliveryScreenShell>
  );
}
