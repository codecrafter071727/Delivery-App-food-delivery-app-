/**
 * Notification Service API types.
 * Gateway: /api/v1/notification-service
 */

export type PaginationMeta = {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNext?: boolean;
};

export type NotificationType =
  | 'order'
  | 'promo'
  | 'payment'
  | 'system'
  | 'delivery'
  | 'support'
  | 'earning'
  | string;

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  isRead: boolean;
  createdAt?: string;
  data?: Record<string, unknown>;
  imageUrl?: string;
};

export type NotificationListResult = {
  notifications: AppNotification[];
  meta?: PaginationMeta;
};

export type UnreadCountResult = {
  count: number;
};

/** Local preference keys — persisted until a prefs API exists. */
export type NotificationPreferenceKey =
  | 'orders'
  | 'earnings'
  | 'support'
  | 'promo'
  | 'system';

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  orders: true,
  earnings: true,
  support: true,
  promo: false,
  system: true,
};

export const NOTIFICATION_PREFERENCE_META: {
  key: NotificationPreferenceKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'orders',
    label: 'New Order Alerts',
    description: 'New assignments and delivery updates',
  },
  {
    key: 'earnings',
    label: 'Payment & Earnings',
    description: 'Payouts, tips, and incentives',
  },
  {
    key: 'support',
    label: 'Support Messages',
    description: 'Replies from support and tickets',
  },
  {
    key: 'promo',
    label: 'Promotional Offers',
    description: 'Campaigns and bonus offers',
  },
  {
    key: 'system',
    label: 'System Announcements',
    description: 'App and account notices',
  },
];

/** GET/PUT /preferences — notification-service channel DTO. */
export type NotificationChannelPreferences = {
  ordersPush: boolean;
  offersPush: boolean;
  promoPush: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
};

export type NotificationPushDevice = {
  deviceId: string;
  platform?: string;
  app?: string;
  tokenMasked?: string;
};
