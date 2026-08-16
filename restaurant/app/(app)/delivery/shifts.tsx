import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerAvailabilityManager } from '@/components/delivery/shifts';

/** /delivery/shifts */
export default function DeliveryShiftsRoute() {
  return (
    <DeliveryScreenShell title="Shifts" flush>
      <PartnerAvailabilityManager />
    </DeliveryScreenShell>
  );
}
