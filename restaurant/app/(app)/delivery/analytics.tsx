import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerAnalyticsManager } from '@/components/delivery/analytics/AnalyticsManager';

/** /delivery/analytics */
export default function DeliveryAnalyticsRoute() {
  return (
    <DeliveryScreenShell title="Analytics" flush hideHeader>
      <PartnerAnalyticsManager />
    </DeliveryScreenShell>
  );
}
