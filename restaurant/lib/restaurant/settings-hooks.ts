import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/dashboard/hooks';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { restaurantOutletKeys } from '@/lib/restaurant/hooks';
import { onboardingKeys } from '@/lib/restaurant/onboarding-hooks';
import {
  restaurantSettingsApi,
  toOwnerRestaurant,
} from '@/lib/restaurant/settings-api';
import type {
  AddStaffPayload,
  InviteStaffPayload,
  StaffRoster,
  UpdateRestaurantPayload,
  UpdateRestaurantStatusPayload,
  UpdateSettingsPayload,
  UpdateStaffPayload,
  UpdateTimingsPayload,
} from '@/lib/restaurant/settings-types';

const SETTINGS_ROOT = ['restaurant-settings'] as const;

export const restaurantSettingsKeys = {
  all: SETTINGS_ROOT,
  detail: (restaurantId: string) =>
    [...SETTINGS_ROOT, 'detail', restaurantId] as const,
  staff: (restaurantId: string) =>
    [...SETTINGS_ROOT, 'staff', restaurantId] as const,
  health: [...SETTINGS_ROOT, 'health'] as const,
};

export function useRestaurantDetail(enabled = true) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';

  const query = useQuery({
    queryKey: restaurantSettingsKeys.detail(restaurantId),
    queryFn: () => restaurantSettingsApi.getRestaurant(restaurantId),
    enabled: Boolean(restaurantId) && enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name ?? query.data?.name,
  };
}

export function useRestaurantStaff(enabled = true) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';

  const query = useQuery({
    queryKey: restaurantSettingsKeys.staff(restaurantId),
    queryFn: () => restaurantSettingsApi.getStaff(restaurantId),
    enabled: Boolean(restaurantId) && enabled,
    staleTime: 20_000,
    retry: 1,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useRestaurantSettingsMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: restaurantSettingsKeys.detail(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: ['owner-restaurant', 'my'],
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantSettingsKeys.staff(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: dashboardKeys.all,
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.timings(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.holidays(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.specialHours(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.duty(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: onboardingKeys.all,
      }),
    ]);
  };

  const seedDetail = (detail: Awaited<
    ReturnType<typeof restaurantSettingsApi.getRestaurant>
  >) => {
    queryClient.setQueryData(
      restaurantSettingsKeys.detail(restaurantId),
      detail
    );
    queryClient.setQueryData(['owner-restaurant', 'my'], toOwnerRestaurant(detail));
  };

  const updateProfile = useMutation({
    mutationFn: (payload: UpdateRestaurantPayload) =>
      restaurantSettingsApi.updateRestaurant(restaurantId, payload),
    onSuccess: async (detail) => {
      seedDetail(detail);
      await invalidate();
    },
  });

  const updateStatus = useMutation({
    mutationFn: (payload: UpdateRestaurantStatusPayload) =>
      restaurantSettingsApi.updateStatus(restaurantId, payload),
    onSuccess: async (detail) => {
      seedDetail(detail);
      await invalidate();
    },
  });

  const updateTimings = useMutation({
    mutationFn: (payload: UpdateTimingsPayload) =>
      restaurantSettingsApi.updateTimings(restaurantId, payload),
    onSuccess: async (detail) => {
      seedDetail(detail);
      await invalidate();
    },
  });

  const updateSettings = useMutation({
    mutationFn: (payload: UpdateSettingsPayload) =>
      restaurantSettingsApi.updateSettings(restaurantId, payload),
    onSuccess: async (detail) => {
      seedDetail(detail);
      await invalidate();
    },
  });

  const uploadLogo = useMutation({
    mutationFn: (file: { uri: string; fileName: string; mimeType: string }) =>
      restaurantSettingsApi.uploadLogo(restaurantId, file),
    onSuccess: async (detail) => {
      if (detail.id) seedDetail(detail);
      await invalidate();
    },
  });

  const uploadCover = useMutation({
    mutationFn: (file: { uri: string; fileName: string; mimeType: string }) =>
      restaurantSettingsApi.uploadCover(restaurantId, file),
    onSuccess: async (detail) => {
      if (detail.id) seedDetail(detail);
      await invalidate();
    },
  });

  const uploadGallery = useMutation({
    mutationFn: (
      files: { uri: string; fileName: string; mimeType: string }[]
    ) => restaurantSettingsApi.uploadGalleryImages(restaurantId, files),
    onSuccess: async (detail) => {
      if (detail.id) seedDetail(detail);
      await invalidate();
    },
  });

  const deleteGalleryImage = useMutation({
    mutationFn: (image: { id?: string; url: string }) =>
      restaurantSettingsApi.deleteGalleryImage(restaurantId, image),
    onSuccess: async (detail) => {
      if (detail.id) seedDetail(detail);
      await invalidate();
    },
  });

  const addStaff = useMutation({
    mutationFn: (payload: AddStaffPayload) =>
      restaurantSettingsApi.addStaff(restaurantId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: restaurantSettingsKeys.staff(restaurantId),
      });
    },
  });

  const inviteStaff = useMutation({
    mutationFn: (payload: InviteStaffPayload) =>
      restaurantSettingsApi.inviteStaff(restaurantId, payload),
    onSuccess: async (created) => {
      queryClient.setQueryData<StaffRoster>(
        restaurantSettingsKeys.staff(restaurantId),
        (prev) => ({
          members: prev?.members ?? [],
          pendingInvites: [
            created,
            ...(prev?.pendingInvites ?? []).filter(
              (row) => row.inviteId !== created.inviteId
            ),
          ],
        })
      );
      await queryClient.invalidateQueries({
        queryKey: restaurantSettingsKeys.staff(restaurantId),
      });
    },
  });

  const updateStaff = useMutation({
    mutationFn: ({
      staffId,
      payload,
    }: {
      staffId: string;
      payload: UpdateStaffPayload;
    }) => restaurantSettingsApi.updateStaff(restaurantId, staffId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: restaurantSettingsKeys.staff(restaurantId),
      });
    },
  });

  const removeStaff = useMutation({
    mutationFn: (staffId: string) =>
      restaurantSettingsApi.removeStaff(restaurantId, staffId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: restaurantSettingsKeys.staff(restaurantId),
      });
    },
  });

  return {
    updateProfile,
    updateStatus,
    updateTimings,
    updateSettings,
    uploadLogo,
    uploadCover,
    uploadGallery,
    deleteGalleryImage,
    addStaff,
    inviteStaff,
    updateStaff,
    removeStaff,
  };
}
