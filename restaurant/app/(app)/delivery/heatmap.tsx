import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { DemandHeatmapScreen } from '@/components/delivery/heatmap';

/** /delivery/heatmap */
export default function DeliveryHeatmapRoute() {
  return (
    <DeliveryScreenShell title="Demand" flush>
      <DemandHeatmapScreen />
    </DeliveryScreenShell>
  );
}
