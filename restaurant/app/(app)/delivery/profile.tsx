import { PartnerProfileManager } from '@/components/delivery/profile';
import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';

/** /delivery/profile — UI: components/delivery/profile */
export default function DeliveryProfileRoute() {
  return (
    <DeliveryScreenShell title="Profile" hideHeader flush>
      <PartnerProfileManager />
    </DeliveryScreenShell>
  );
}
