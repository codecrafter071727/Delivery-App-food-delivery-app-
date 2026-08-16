import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/setup */
export default function LegacyDeliverySetup() {
  return <Redirect href={DELIVERY_ROUTES.setup} />;
}
