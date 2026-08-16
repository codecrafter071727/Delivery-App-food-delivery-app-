import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/restaurants */
export default function LegacyPartnerRestaurants() {
  return <Redirect href={DELIVERY_ROUTES.restaurants} />;
}
