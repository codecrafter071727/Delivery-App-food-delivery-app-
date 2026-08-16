import { AuthShell } from '@/components/auth/AuthShell';
import { DeliveryRegisterWizard } from '@/components/delivery/auth/RegisterWizard';

/** /delivery/setup — finish partner registration while logged in */
export default function DeliverySetupRoute() {
  return (
    <AuthShell
      title="Complete delivery profile"
      subtitle="Tell us about your vehicle and finish partner registration."
    >
      <DeliveryRegisterWizard profileOnly />
    </AuthShell>
  );
}
