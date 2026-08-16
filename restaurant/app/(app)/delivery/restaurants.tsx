import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerRestaurantsManager } from '@/components/delivery/restaurants';

/** /delivery/restaurants */
export default function DeliveryRestaurantsRoute() {
  return (
    <DeliveryScreenShell title="Restaurants" flush>
      <PartnerRestaurantsManager />
    </DeliveryScreenShell>
  );
}
