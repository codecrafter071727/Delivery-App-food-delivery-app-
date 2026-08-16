import type {
  RestaurantAddress,
  RestaurantLocation,
} from '@/lib/restaurant/types';

export type PriceRange =
  | 'budget'
  | 'moderate'
  | 'expensive'
  | 'fine_dining'
  | string;

export type DayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type TimeSlot = {
  open: string;
  close: string;
};

export type DayTiming = {
  isOpen: boolean;
  slots: TimeSlot[];
};

export type RestaurantTimings = Record<DayKey, DayTiming>;

export type RestaurantSettings = {
  taxRate?: number;
  packagingCharge?: number;
  minOrderValue?: number;
  freeDeliveryThreshold?: number;
  maxDeliveryRadius?: number;
  avgPreparationTime?: number;
  autoAcceptOrders?: boolean;
  acceptScheduledOrders?: boolean;
  acceptPreOrders?: boolean;
  pureVegetarian?: boolean;
  cashOnDelivery?: boolean;
  onlinePayments?: boolean;
  sellsAlcohol?: boolean;
  [key: string]: unknown;
};

export type RestaurantGalleryImage = {
  id: string;
  url: string;
};

/** Kitchen photo uploads — matches restaurant-service multer limits. */
export const RESTAURANT_PHOTO = {
  maxBytes: 5 * 1024 * 1024,
  maxGallery: 10,
  mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const,
} as const;

export type RestaurantDetail = {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  status?: string;
  isOpen?: boolean;
  isOnline?: boolean;
  isActive?: boolean;
  fssaiLicense?: string;
  gstin?: string;
  phone?: string;
  priceRange?: PriceRange;
  costForTwo?: number;
  cuisines?: string[];
  address?: Partial<RestaurantAddress>;
  location?: RestaurantLocation;
  /** False when API stored coordinates without GeoJSON type: "Point". */
  locationGeoValid?: boolean;
  timings?: RestaurantTimings;
  settings?: RestaurantSettings;
  images?: RestaurantGalleryImage[];
  [key: string]: unknown;
};

export type UpdateRestaurantPayload = {
  name?: string;
  description?: string;
  fssaiLicense?: string;
  gstin?: string;
  phone?: string;
  priceRange?: PriceRange;
  costForTwo?: number;
  cuisines?: string[];
  address?: Partial<RestaurantAddress>;
  location?: RestaurantLocation;
};

export type UpdateRestaurantStatusPayload = {
  isOpen?: boolean;
  isOnline?: boolean;
  isActive?: boolean;
  status?: 'open' | 'closed' | 'online' | 'offline' | string;
};

export type UpdateTimingsPayload = {
  timings: RestaurantTimings;
};

export type UpdateSettingsPayload = RestaurantSettings;

/** Stored / API roles. `kitchen_staff` is accepted as an alias → `kitchen`. */
export type StaffRole = 'manager' | 'kitchen' | 'cashier';
export type StaffListRole = 'owner' | StaffRole;
export type StaffPermission =
  | 'view_orders'
  | 'update_orders'
  | 'manage_menu'
  | 'view_reports'
  | 'manage_staff';

export const STAFF_PERMISSIONS: { key: StaffPermission; label: string }[] = [
  { key: 'view_orders', label: 'View orders' },
  { key: 'update_orders', label: 'Update orders' },
  { key: 'manage_menu', label: 'Menu' },
  { key: 'view_reports', label: 'Reports' },
  { key: 'manage_staff', label: 'Manage team' },
];

export const STAFF_ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'cashier', label: 'Cashier' },
];

export const DEFAULT_STAFF_PERMISSIONS: Record<StaffRole, StaffPermission[]> = {
  manager: [
    'view_orders',
    'update_orders',
    'manage_menu',
    'view_reports',
    'manage_staff',
  ],
  kitchen: ['view_orders', 'update_orders'],
  cashier: ['view_orders', 'update_orders'],
};

export function formatStaffRole(role?: string | null): string {
  const raw = String(role ?? '').trim().toLowerCase();
  if (raw === 'owner') return 'Owner';
  if (raw === 'kitchen_staff' || raw === 'kitchen') return 'Kitchen';
  const match = STAFF_ROLE_OPTIONS.find((option) => option.value === raw);
  if (match) return match.label;
  if (!raw) return 'Staff';
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export type RestaurantStaffMember = {
  staffId: string | null;
  userId: string;
  role: StaffListRole | string;
  permissions: StaffPermission[];
  isActive: boolean;
  lastSeenAt?: string | null;
  name?: string | null;
  phoneMasked?: string | null;
  emailMasked?: string | null;
  joinedAt?: string | null;
};

export type StaffInvite = {
  inviteId: string;
  name: string;
  phoneMasked?: string | null;
  emailMasked?: string | null;
  role: StaffRole | string;
  permissions: StaffPermission[];
  status: string;
  expiresAt?: string;
  inviteUrl?: string;
  deliveredVia?: string[];
  createdAt?: string;
};

export type StaffRoster = {
  members: RestaurantStaffMember[];
  pendingInvites: StaffInvite[];
};

export type InviteStaffPayload = {
  name: string;
  phone?: string;
  email?: string;
  role: StaffRole;
  permissions?: StaffPermission[];
};

export type AddStaffPayload = {
  userId: string;
  role: StaffRole;
  permissions?: StaffPermission[];
  name?: string;
  phone?: string;
  email?: string;
};

export type UpdateStaffPayload = {
  role?: StaffRole;
  permissions?: StaffPermission[];
  isActive?: boolean;
};

export const WEEK_DAYS: { key: DayKey; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

export const PRICE_RANGE_OPTIONS: { id: PriceRange; label: string }[] = [
  { id: 'budget', label: 'Budget' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'expensive', label: 'Expensive' },
  { id: 'fine_dining', label: 'Fine Dining' },
];

export const CUISINE_OPTIONS = [
  'North Indian',
  'South Indian',
  'Chinese',
  'Italian',
  'Mexican',
  'Thai',
  'Japanese',
  'Continental',
  'Mughlai',
  'Punjabi',
  'Biryani',
  'Fast Food',
  'Street Food',
  'Pizza',
  'Burger',
  'Desserts',
  'Beverages',
  'Seafood',
  'Mediterranean',
  'Lebanese',
  'Korean',
] as const;

export function emptyTimings(): RestaurantTimings {
  return WEEK_DAYS.reduce((acc, day) => {
    acc[day.key] = { isOpen: false, slots: [{ open: '09:00', close: '22:00' }] };
    return acc;
  }, {} as RestaurantTimings);
}
