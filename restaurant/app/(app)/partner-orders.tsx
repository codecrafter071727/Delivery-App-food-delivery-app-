import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/orders */
export default function LegacyPartnerOrders() {
  return <Redirect href={DELIVERY_ROUTES.orders} />;
}
