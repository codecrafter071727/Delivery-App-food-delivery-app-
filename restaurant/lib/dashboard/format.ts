export function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 17) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

export function formatCurrency(amount: number, currency = 'INR'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: safe % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function splitCurrency(amount: number): { whole: string; fraction: string } {
  const formatted = formatCurrency(amount);
  const match = formatted.match(/^(.+?)([.,]\d{2})$/);
  if (!match) return { whole: formatted, fraction: '' };
  return { whole: match[1], fraction: match[2] };
}

export function formatOrderTime(iso?: string): string {
  if (!iso) return '--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function summarizeItems(
  items: { name: string; quantity: number }[],
  max = 2
): string {
  if (!items.length) return 'No items listed';
  const head = items.slice(0, max).map((item) => `${item.quantity}x ${item.name}`);
  const tail = items.length > max ? ` +${items.length - max} more` : '';
  return head.join(', ') + tail;
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

export function computeTrendPercent(today: number, yesterday: number): number {
  if (yesterday <= 0) return today > 0 ? 100 : 0;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

type DashboardInsightCopy = {
  title: string;
  subtitle: string;
};

export function trendInsight(trendPercent: number): DashboardInsightCopy {
  if (trendPercent >= 8) {
    return {
      title: 'Excellent flow\nthis morning',
      subtitle: 'Revenue is pacing ahead of yesterday\'s target.',
    };
  }
  if (trendPercent >= 0) {
    return {
      title: 'Steady performance\ntoday',
      subtitle: 'You are on track compared to yesterday.',
    };
  }
  return {
    title: 'Room to grow\ntoday',
    subtitle: 'Push promos and prep time to recover momentum.',
  };
}

export function buildRevenueBars(totalRevenue: number, totalOrders: number): number[] {
  const base = Math.max(totalRevenue, totalOrders * 120, 1);
  const weights = [0.18, 0.32, 0.48, 0.68, 1];
  return weights.map((weight) => Math.max(12, Math.round(base * weight * 0.0025)));
}
