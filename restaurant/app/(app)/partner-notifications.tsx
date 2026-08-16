import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/notifications */
export default function LegacyPartnerNotifications() {
  return <Redirect href={DELIVERY_ROUTES.notifications} />;
}
