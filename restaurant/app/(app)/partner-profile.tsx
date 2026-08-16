import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/profile */
export default function LegacyPartnerProfile() {
  return <Redirect href={DELIVERY_ROUTES.profile} />;
}
