import { Redirect } from 'expo-router';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** @deprecated Use /delivery/documents */
export default function LegacyPartnerDocuments() {
  return <Redirect href={DELIVERY_ROUTES.documents} />;
}
