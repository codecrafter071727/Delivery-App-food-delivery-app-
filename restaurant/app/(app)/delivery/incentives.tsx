import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerIncentivesManager } from '@/components/delivery/incentives/IncentivesManager';

/** /delivery/incentives */
export default function DeliveryIncentivesRoute() {
  return (
    <DeliveryScreenShell title="Incentives" flush hideHeader>
      <PartnerIncentivesManager />
    </DeliveryScreenShell>
  );
}
