import { DeliveryHomeScreen } from '@/components/delivery/home/HomeScreen';
import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';

/** /delivery — partner home */
export default function DeliveryHomeRoute() {
  return (
    <DeliveryScreenShell title="Home" hideHeader flush>
      <DeliveryHomeScreen />
    </DeliveryScreenShell>
  );
}
