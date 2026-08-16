export type RestaurantAddress = {
  street: string;
  area?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
};

export type RestaurantLocation = {
  type: 'Point';
  /** [lng, lat] */
  coordinates: [number, number];
};

export type CreateRestaurantPayload = {
  name: string;
  description?: string;
  fssaiLicense?: string;
  gstin?: string;
  priceRange?: 'budget' | 'moderate' | 'expensive' | 'fine_dining' | string;
  costForTwo?: number;
  cuisines?: string[];
  address: RestaurantAddress;
  location: RestaurantLocation;
};

export type RestaurantOwnerRestaurant = {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  status?: string;
  listingStatus?: string;
  phone?: string;
  cuisines?: string[];
  [key: string]: unknown;
};

export type CuisineChip = {
  slug: string;
  name: string;
  restaurantCount?: number;
  imageUrl?: string | null;
};

export type KitchenDutySnapshot = {
  restaurantId: string;
  status: string;
  isOnline: boolean;
  duty: 'online' | 'offline' | 'paused' | string;
  pausedUntil: string | null;
  pauseReason: string | null;
  acceptScheduled: boolean;
  autoAccept: boolean;
  openNow: boolean;
};

export type PauseReasonCode =
  | 'too_busy'
  | 'staffing'
  | 'packaging'
  | 'closing_soon'
  | 'other';

export type KitchenSurgeStatus = {
  restaurantId: string;
  zoneId?: string;
  name?: string;
  city?: string;
  surgeMultiplier: number;
  surgeActive: boolean;
  reason: string;
  assigned: boolean;
  unavailable: boolean;
  message?: string;
};

export type HolidayRow = {
  date: string;
  reason?: string;
};

export type SpecialHoursDay = {
  date: string;
  isOpen: boolean;
  slots: { open: string; close: string }[];
  reason?: string;
};

export type OutletHygiene = {
  restaurantId: string;
  available: boolean;
  fssaiMasked: string | null;
  hygieneScore: number;
  lastAuditAt: string | null;
  message?: string;
};

export type OutletRatings = {
  restaurantId: string;
  available: boolean;
  avgRating: number;
  totalRatings: number;
  breakdown: { 1: number; 2: number; 3: number; 4: number; 5: number };
  message?: string;
};

export type OutletDayTiming = {
  isOpen: boolean;
  slots: { open: string; close: string }[];
};

export type OutletWeekTimings = {
  monday: OutletDayTiming;
  tuesday: OutletDayTiming;
  wednesday: OutletDayTiming;
  thursday: OutletDayTiming;
  friday: OutletDayTiming;
  saturday: OutletDayTiming;
  sunday: OutletDayTiming;
};

export type OutletTimings = {
  timezone: string;
  isOpenNow: boolean;
  nextOpenAt: string | null;
  week: OutletWeekTimings;
  holidays: HolidayRow[];
};

export type KitchenAppConfig = {
  restaurantId: string;
  minSupportedAppVersion: string;
  latestAppVersion: string;
  forceUpdate: boolean;
  updateAvailable: boolean;
  timezone: string;
  featureFlags: Record<string, boolean>;
  rejectReasons: Array<{ code: string; label: string }>;
};

export type RestaurantServiceHealth = {
  ok: boolean;
  ready: boolean;
  message?: string;
};

export type SpiceLevel = 'none' | 'mild' | 'medium' | 'hot';

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner' | 'late_night';

export type CategorySchedulePeriod = {
  meal: MealPeriod;
  from: string;
  to: string;
  days?: string[];
};

export type MenuCategory = {
  id: string;
  name: string;
  description?: string;
  sortOrder?: number;
  itemCount?: number;
  isActive?: boolean;
  availableFrom?: string;
  availableTo?: string;
  schedule?: { periods: CategorySchedulePeriod[] };
};

export type ModifierOption = {
  id: string;
  name: string;
  price: number;
  isDefault?: boolean;
  isAvailable?: boolean;
};

export type ModifierGroup = {
  id: string;
  name: string;
  description?: string | null;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  sortOrder?: number;
  options: ModifierOption[];
};

export type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price: number;
  discountPrice?: number;
  imageUrl?: string;
  categoryId?: string;
  categoryName?: string;
  isVeg?: boolean;
  isAvailable?: boolean;
  unavailableUntil?: string | null;
  unavailableReason?: string | null;
  spiceLevel?: SpiceLevel | string;
  tags?: string[];
  sortOrder?: number;
  modifierGroups?: ModifierGroup[];
};

export type CreateCategoryPayload = {
  name: string;
  description?: string;
  sortOrder?: number;
};

export type UpdateCategoryPayload = {
  name?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type CreateMenuItemPayload = {
  name: string;
  description?: string;
  price: number;
  discountPrice?: number;
  isVeg?: boolean;
  isAvailable?: boolean;
  spiceLevel?: SpiceLevel | string;
  tags?: string[] | string;
  imageUrl?: string;
};

export type UpdateMenuItemPayload = Partial<CreateMenuItemPayload>;

export type BulkImportCategory = CreateCategoryPayload & {
  items?: CreateMenuItemPayload[];
};

export type BulkImportPayload = {
  categories?: BulkImportCategory[];
  items?: (CreateMenuItemPayload & {
    categoryName?: string;
    categoryId?: string;
    discountedPrice?: number;
  })[];
  menu?: { categories?: BulkImportCategory[] };
  categoryId?: string;
};

export type AvailabilityPayload = {
  isAvailable: boolean;
  unavailableUntil?: string | null;
  reason?: string | null;
};

export type CreateModifierGroupPayload = {
  name: string;
  description?: string;
  minSelect?: number;
  maxSelect?: number;
  isRequired?: boolean;
  sortOrder?: number;
  options: Array<{
    id?: string;
    name: string;
    price: number;
    isDefault?: boolean;
    isAvailable?: boolean;
  }>;
};

export type AttachModifiersPayload = {
  attachments: Array<{
    groupId: string;
    options?: Array<{
      optionId: string;
      price?: number;
      isAvailable?: boolean;
    }>;
  }>;
};

export type BulkPriceUpdate = {
  itemId: string;
  price: number;
  discountedPrice?: number | null;
};

export type OfferDiscountType =
  | 'percentage'
  | 'flat'
  | 'free_delivery'
  | 'bogo';

export type OfferLifecycleStatus = 'active' | 'scheduled' | 'inactive';

export type RestaurantOffer = {
  id: string;
  restaurantId?: string;
  title: string;
  description?: string;
  code?: string;
  discountType?: OfferDiscountType | string;
  discountValue?: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  validFrom?: string;
  validUntil?: string;
  isActive?: boolean;
  usageCount?: number;
  usageLimit?: number;
  perUserLimit?: number;
  status?: OfferLifecycleStatus | string;
};

export type CreateOfferPayload = {
  title: string;
  code: string;
  discountType: OfferDiscountType;
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number;
  description?: string;
  validFrom: string;
  validUntil: string;
  isActive?: boolean;
  usageLimit?: number;
  perUserLimit?: number;
};

export type UpdateOfferPayload = Partial<CreateOfferPayload>;
