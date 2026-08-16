export type ChainMatchBy = 'name' | 'name_and_category';
export type ChainCloneMode = 'merge' | 'replace';

export type ChainSibling = {
  restaurantId: string;
  name: string;
  status?: string;
  isOnline?: boolean;
  city?: string;
  isSource: boolean;
};

export type ChainCloneTargetResult = {
  restaurantId: string;
  name: string;
  categoriesCreated: number;
  categoriesReused: number;
  groupsCreated: number;
  itemsCreated: number;
  itemsSkipped: number;
  cleared: boolean;
  error?: string;
};

export type ChainCloneResult = {
  sourceRestaurantId: string;
  targets: ChainCloneTargetResult[];
};

export type ChainUnmatchedSku = {
  name: string;
  categoryName?: string;
};

export type ChainApplyTargetResult = {
  restaurantId: string;
  name: string;
  matched: number;
  updated: number;
  unmatched: ChainUnmatchedSku[];
  error?: string;
};

export type ChainApplyResult = {
  sourceRestaurantId: string;
  matchBy?: ChainMatchBy;
  isAvailable?: boolean;
  targets: ChainApplyTargetResult[];
};

export type ChainSettingsTargetResult = {
  restaurantId: string;
  name: string;
  applied: boolean;
  error?: string;
};

export type ChainSettingsResult = {
  sourceRestaurantId: string;
  appliedKeys: string[];
  targets: ChainSettingsTargetResult[];
};

export type CloneMenuPayload = {
  targetRestaurantIds: string[];
  mode: ChainCloneMode;
  itemIds?: string[];
};

export type ApplyPricesPayload = {
  targetRestaurantIds: string[];
  matchBy: ChainMatchBy;
  itemIds?: string[];
};

export type ApplyAvailabilityPayload = {
  targetRestaurantIds: string[];
  matchBy: ChainMatchBy;
  itemIds?: string[];
  isAvailable: boolean;
  unavailableUntil?: string | null;
  reason?: string | null;
};

export type ApplySettingsPayload = {
  targetRestaurantIds: string[];
  copyFromSource?: boolean;
};
