import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/earnings */
export default function LegacyPartnerEarnings() {
  return <Redirect href={DELIVERY_ROUTES.earnings} />;
}
