export type PlatformUser = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  photoUrl?: string;
  emailVerified: boolean;
  phoneVerified?: boolean;
  language?: string;
  role?: string;
};

export type NotificationPrefs = {
  push: boolean;
  sms: boolean;
  email: boolean;
};

export type UserPreferences = {
  notifications: NotificationPrefs;
  language: string;
  languages: string[];
};

export type DeletePreview = {
  openOrders: number;
  walletBalance: number;
  activeSubscription: boolean;
  canDelete: boolean;
  warn?: string | null;
};

export type UpdateNamePayload = {
  firstName: string;
  lastName?: string;
};

export type UserSession = {
  id: string;
  current: boolean;
  deviceId?: string;
  deviceName: string;
  platform?: string;
  ip?: string;
  location?: string;
  lastSeenAt?: string;
  createdAt?: string;
  userAgent?: string;
};

export type UserDevice = {
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  app?: string;
  tokenMasked: string;
  clientDeviceId?: string;
  appVersion?: string | null;
  lastSeenAt?: string;
  registeredAt?: string;
};

export type RegisterDevicePayload = {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId: string;
  appVersion?: string;
  app?: 'rider' | 'kitchen' | 'customer';
};

export type StoredPushDevice = {
  deviceId: string;
  clientDeviceId: string;
  platform: 'ios' | 'android' | 'web';
  tokenMasked: string;
};

export const DEFAULT_LANGUAGES = ['en', 'hi'] as const;

export function languageLabel(code: string): string {
  const key = code.trim().toLowerCase();
  if (key === 'en' || key.startsWith('en-')) return 'English';
  if (key === 'hi' || key.startsWith('hi-')) return 'हिन्दी';
  if (key === 'mr') return 'मराठी';
  if (key === 'bn') return 'বাংলা';
  if (key === 'ta') return 'தமிழ்';
  if (key === 'te') return 'తెలుగు';
  if (key === 'gu') return 'ગુજરાતી';
  if (key === 'kn') return 'ಕನ್ನಡ';
  if (key === 'ml') return 'മലയാളം';
  if (key === 'pa') return 'ਪੰਜਾਬੀ';
  return code.toUpperCase();
}

export function displayPlatformName(user?: PlatformUser | null): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return name;
}
