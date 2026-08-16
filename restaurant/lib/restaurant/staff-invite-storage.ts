import {
  storageDeleteItem,
  storageGetItem,
  storageSetItem,
} from '@/lib/storage';

const KEY = 'pending_staff_invite';

export type PendingStaffInvite = {
  token: string;
  restaurantId: string;
};

export async function savePendingStaffInvite(invite: PendingStaffInvite) {
  await storageSetItem(KEY, JSON.stringify(invite));
}

export async function peekPendingStaffInvite(): Promise<PendingStaffInvite | null> {
  try {
    const raw = await storageGetItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingStaffInvite;
    if (!parsed.token || !parsed.restaurantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function consumePendingStaffInvite(): Promise<PendingStaffInvite | null> {
  const invite = await peekPendingStaffInvite();
  await storageDeleteItem(KEY);
  return invite;
}
