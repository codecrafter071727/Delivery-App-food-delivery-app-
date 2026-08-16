import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerNotificationsManager } from '@/components/delivery/notifications';

/** /delivery/notifications */
export default function DeliveryNotificationsRoute() {
  return (
    <DeliveryScreenShell title="Notifications" flush>
      <PartnerNotificationsManager />
    </DeliveryScreenShell>
  );
}
