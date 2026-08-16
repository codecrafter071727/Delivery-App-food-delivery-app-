import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerOrdersManager } from '@/components/delivery/orders/OrdersManager';

/** /delivery/orders */
export default function DeliveryOrdersRoute() {
  return (
    <DeliveryScreenShell title="Orders" flush>
      <PartnerOrdersManager />
    </DeliveryScreenShell>
  );
}
