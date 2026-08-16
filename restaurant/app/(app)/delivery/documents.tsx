import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';
import { PartnerDocumentsManager } from '@/components/delivery/documents';

/** /delivery/documents */
export default function DeliveryDocumentsRoute() {
  return (
    <DeliveryScreenShell title="Documents" flush>
      <PartnerDocumentsManager />
    </DeliveryScreenShell>
  );
}
