import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerSupportManager } from '@/components/delivery/support';

/** /delivery/support */
export default function DeliverySupportRoute() {
  return (
    <DeliveryScreenShell title="Support" flush>
      <PartnerSupportManager />
    </DeliveryScreenShell>
  );
}
