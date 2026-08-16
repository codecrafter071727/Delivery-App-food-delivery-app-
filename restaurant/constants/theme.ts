/** Shared brand palette — mirrors customer app + tailwind.config.js */
export const theme = {
  primary: '#EA4B14',
  primaryDark: '#C23D0F',
  primaryLight: '#F97316',
  secondary: '#0F172A',
  secondaryLight: '#64748B',
  surface: '#F6F6F7',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  muted: '#94A3B8',
  border: '#EBEBEB',
  white: '#FFFFFF',
} as const;

export const BRAND_NAME = 'TOKAJO FOODS';
export const BRAND_YELLOW = '#F5C518';

export const PORTAL_LABELS = {
  restaurant: 'Restaurant Portal',
  delivery: 'Delivery Portal',
} as const;

export const buttonGradient = ['#EA4B14', '#C23D0F'] as const;
export const heroGradient = ['#EA4B14', '#C23D0F'] as const;

export const cardShadow = {
  shadowColor: '#1E293B',
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;
