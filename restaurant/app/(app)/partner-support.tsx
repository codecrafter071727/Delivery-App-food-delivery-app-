import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/support */
export default function LegacyPartnerSupport() {
  return <Redirect href={DELIVERY_ROUTES.support} />;
}
