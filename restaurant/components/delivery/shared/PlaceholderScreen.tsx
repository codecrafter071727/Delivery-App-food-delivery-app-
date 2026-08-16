import { DeliveryScreenShell } from '@/components/delivery/shared/ScreenShell';

type Props = {
  title: string;
  subtitle: string;
};

/** Temporary screen body until a feature module is built under components/delivery/<feature>. */
export function DeliveryPlaceholderScreen({ title, subtitle }: Props) {
  return <DeliveryScreenShell title={title} subtitle={subtitle} />;
}
