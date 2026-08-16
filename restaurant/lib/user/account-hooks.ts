import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AuthUser } from '@/lib/auth/types';
import { getAuthDeviceId } from '@/lib/auth/device';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { formatAccountError, userAccountApi } from '@/lib/user/account-api';
import type {
  NotificationPrefs,
  PlatformUser,
  RegisterDevicePayload,
} from '@/lib/user/account-types';
import {
  clearStoredPushDevice,
  loadStoredPushDevice,
  saveStoredPushDevice,
} from '@/lib/user/push-token';
import { useAuthStore } from '@/store/auth-store';

export const platformAccountKeys = {
  all: ['user-service', 'me'] as const,
  profile: () => [...platformAccountKeys.all, 'profile'] as const,
  preferences: () => [...platformAccountKeys.all, 'preferences'] as const,
  deletePreview: () => [...platformAccountKeys.all, 'delete-preview'] as const,
  sessions: () => [...platformAccountKeys.all, 'sessions'] as const,
  devices: () => [...platformAccountKeys.all, 'devices'] as const,
};

const keepRetrying = (failureCount: number, error: unknown) => {
  const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
  if (msg.includes('too many request') || msg.includes('rate limit')) return false;
  return failureCount < 2;
};

function toAuthPatch(user: PlatformUser): Partial<AuthUser> {
  const patch: Partial<AuthUser> = {};
  if (user.id) patch.id = user.id;
  if (user.email) patch.email = user.email;
  if (user.firstName !== undefined) patch.firstName = user.firstName;
  if (user.lastName !== undefined) patch.lastName = user.lastName;
  if (user.phone !== undefined) patch.phone = user.phone;
  if (user.emailVerified !== undefined) patch.emailVerified = user.emailVerified;
  if (user.photoUrl !== undefined) patch.photoUrl = user.photoUrl;
  return patch;
}

export function usePlatformMe(enabled = true) {
  const isActive = useAppIsActive();
  const patchUser = useAuthStore((s) => s.patchUser);

  return useQuery({
    queryKey: platformAccountKeys.profile(),
    queryFn: async () => {
      const user = await userAccountApi.getMe();
      await patchUser(toAuthPatch(user));
      return user;
    },
    enabled,
    staleTime: LIVE_INTERVALS.deliveryMe / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.deliveryMe, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePlatformPreferences(enabled = true) {
  return useQuery({
    queryKey: platformAccountKeys.preferences(),
    queryFn: () => userAccountApi.getPreferences(),
    enabled,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePlatformSessions(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: platformAccountKeys.sessions(),
    queryFn: async () => {
      const deviceId = await getAuthDeviceId();
      return userAccountApi.listSessions(deviceId);
    },
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.deliveryMe, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePlatformDevices(enabled = true) {
  return useQuery({
    queryKey: platformAccountKeys.devices(),
    queryFn: () => userAccountApi.listDevices(),
    enabled,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePlatformAccountMutations() {
  const queryClient = useQueryClient();
  const patchUser = useAuthStore((s) => s.patchUser);

  const syncUser = async (user: PlatformUser) => {
    queryClient.setQueryData(platformAccountKeys.profile(), user);
    await patchUser(toAuthPatch(user));
    await queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.me() });
  };

  const invalidatePrefs = () =>
    queryClient.invalidateQueries({
      queryKey: platformAccountKeys.preferences(),
    });

  const updateName = useMutation({
    mutationFn: userAccountApi.updateName,
    onSuccess: syncUser,
  });

  const uploadPhoto = useMutation({
    mutationFn: userAccountApi.uploadPhoto,
    onSuccess: syncUser,
  });

  const deletePhoto = useMutation({
    mutationFn: userAccountApi.deletePhoto,
    onSuccess: async (user) => {
      await syncUser({ ...user, photoUrl: user.photoUrl || '' });
    },
  });

  const updatePhone = useMutation({
    mutationFn: userAccountApi.updatePhone,
    onSuccess: syncUser,
  });

  const updateEmail = useMutation({
    mutationFn: userAccountApi.updateEmail,
    onSuccess: syncUser,
  });

  const updateNotifications = useMutation({
    mutationFn: (payload: NotificationPrefs) =>
      userAccountApi.updateNotifications(payload),
    onSuccess: (prefs) => {
      queryClient.setQueryData(platformAccountKeys.preferences(), prefs);
    },
  });

  const updateLanguage = useMutation({
    mutationFn: (language: string) => userAccountApi.updateLanguage(language),
    onSuccess: (prefs) => {
      queryClient.setQueryData(platformAccountKeys.preferences(), prefs);
    },
  });

  const deleteAccount = useMutation({
    mutationFn: userAccountApi.deleteAccount,
  });

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => userAccountApi.revokeSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: platformAccountKeys.sessions(),
      });
    },
  });

  const registerDevice = useMutation({
    mutationFn: (payload: RegisterDevicePayload) =>
      userAccountApi.registerDevice(payload),
    onSuccess: async (device) => {
      await saveStoredPushDevice(device);
      queryClient.setQueryData(platformAccountKeys.devices(), (current: unknown) => {
        const list = Array.isArray(current) ? current : [];
        const rest = list.filter(
          (row: { deviceId?: string }) => row.deviceId !== device.deviceId
        );
        return [device, ...rest];
      });
      await queryClient.invalidateQueries({
        queryKey: platformAccountKeys.devices(),
      });
    },
  });

  const unregisterDevice = useMutation({
    mutationFn: async (deviceId: string) => {
      await userAccountApi.unregisterDevice(deviceId);
      const stored = await loadStoredPushDevice();
      if (stored?.deviceId === deviceId) await clearStoredPushDevice();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: platformAccountKeys.devices(),
      });
    },
  });

  return {
    updateName,
    uploadPhoto,
    deletePhoto,
    updatePhone,
    updateEmail,
    updateNotifications,
    updateLanguage,
    deleteAccount,
    revokeSession,
    registerDevice,
    unregisterDevice,
    invalidatePrefs,
    formatError: formatAccountError,
  };
}

export { formatAccountError };
