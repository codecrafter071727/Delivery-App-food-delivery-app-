import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerPerformanceManager } from '@/components/delivery/performance/PerformanceManager';

/** /delivery/performance */
export default function DeliveryPerformanceRoute() {
  return (
    <DeliveryScreenShell title="Performance" flush hideHeader>
      <PartnerPerformanceManager />
    </DeliveryScreenShell>
  );
}
