import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/analytics */
export default function LegacyPartnerAnalytics() {
  return <Redirect href={DELIVERY_ROUTES.analytics} />;
}
