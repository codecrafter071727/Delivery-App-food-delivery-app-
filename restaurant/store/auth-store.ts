import { create } from 'zustand';

import { clearApiSession, SESSION_AUTH_TOKEN } from '@/lib/api';
import { authApi, formatAuthError } from '@/lib/auth/api';
import {
  clearAuthStorage,
  getStoredRole,
  getStoredUser,
  getToken,
  setStoredRole,
  setStoredUser,
  setToken,
} from '@/lib/auth/storage';
import type {
  AppleLoginPayload,
  AuthUser,
  ChangePasswordPayload,
  ForgotPasswordPayload,
  GoogleLoginPayload,
  LoginPayload,
  OtpSendPayload,
  OtpSendResult,
  OtpVerifyPayload,
  PartnerRole,
  RegisterPayload,
  ResetPasswordPayload,
} from '@/lib/auth/types';
import { clearRestaurantSetupFlag, clearDeliveryPartnerSetupFlag } from '@/lib/navigation/post-auth';
import { getApiErrorCode, PartnerApiError } from '@/lib/errors';
import { getStoredSessionCookies } from '@/lib/session-cookies';

function throwAuth(error: unknown, fallback: string): never {
  throw new PartnerApiError(
    formatAuthError(error, fallback),
    getApiErrorCode(error)
  );
}

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  role: PartnerRole;
  isHydrated: boolean;
  isLoading: boolean;
  setRole: (role: PartnerRole) => void;
  hydrate: () => Promise<void>;
  setSession: (token: string, user: AuthUser) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  login: (payload: LoginPayload) => Promise<void>;
  sendOtp: (payload: OtpSendPayload) => Promise<OtpSendResult>;
  resendOtp: (payload: OtpSendPayload) => Promise<OtpSendResult>;
  verifyOtp: (payload: OtpVerifyPayload) => Promise<void>;
  loginGoogle: (payload: GoogleLoginPayload) => Promise<void>;
  loginApple: (payload: AppleLoginPayload) => Promise<void>;
  forgotPassword: (payload: ForgotPasswordPayload) => Promise<string>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<string>;
  verifyEmail: (token: string) => Promise<string>;
  changePassword: (payload: ChangePasswordPayload) => Promise<string>;
  resendEmailVerification: () => Promise<string>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  clearSession: () => Promise<void>;
  patchUser: (partial: Partial<AuthUser>) => Promise<void>;
};

async function persistSession(token: string, user: AuthUser) {
  await setToken(token);
  await setStoredUser(user);
  await setStoredRole(user.role);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  role: 'restaurant',
  isHydrated: false,
  isLoading: false,

  setRole: (role) => {
    set({ role });
    void setStoredRole(role);
  },

  hydrate: async () => {
    if (get().isHydrated) return;

    try {
      const [token, user, storedRole] = await Promise.all([
        getToken(),
        getStoredUser(),
        getStoredRole(),
      ]);

      // Cookie sessions need stored cookies — otherwise treat as logged out.
      if (token === SESSION_AUTH_TOKEN) {
        const cookies = await getStoredSessionCookies();
        if (!cookies) {
          await clearAuthStorage();
          set({
            token: null,
            user: null,
            role: storedRole ?? 'restaurant',
            isHydrated: true,
          });
          return;
        }
      }

      if (!token || !user) {
        set({
          token: null,
          user: null,
          role: storedRole ?? 'restaurant',
          isHydrated: true,
        });
        return;
      }

      // Re-hydrate in-memory session from durable storage.
      set({
        token,
        user,
        role: user.role ?? storedRole ?? 'restaurant',
        isHydrated: true,
      });
    } catch {
      // Never wipe storage on a transient hydrate error — only mark hydrated.
      try {
        const storedRole = await getStoredRole();
        set({
          isHydrated: true,
          role: storedRole ?? get().role ?? 'restaurant',
        });
      } catch {
        set({ isHydrated: true });
      }
    }
  },

  setSession: async (token, user) => {
    await persistSession(token, user);
    // Verify write so a failed SecureStore write can't leave us "logged in" in memory only.
    const savedToken = await getToken();
    const savedUser = await getStoredUser();
    if (!savedToken || !savedUser) {
      throw new Error(
        'Could not save your login on this device. Please try again.'
      );
    }
    set({ token: savedToken, user: savedUser, role: savedUser.role });
  },

  register: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.register(payload);
      await get().setSession(response.token, response.user);
    } catch (error) {
      throwAuth(error, 'Registration failed');
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.login(payload);
      await get().setSession(response.token, response.user);
    } catch (error) {
      throwAuth(error, 'Login failed');
    } finally {
      set({ isLoading: false });
    }
  },

  sendOtp: async (payload) => {
    set({ isLoading: true });
    try {
      return await authApi.sendOtp(payload);
    } catch (error) {
      throwAuth(error, 'Failed to send OTP');
    } finally {
      set({ isLoading: false });
    }
  },

  resendOtp: async (payload) => {
    set({ isLoading: true });
    try {
      return await authApi.resendOtp(payload);
    } catch (error) {
      throwAuth(error, 'Failed to resend OTP');
    } finally {
      set({ isLoading: false });
    }
  },

  verifyOtp: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.verifyOtp(payload);
      await get().setSession(response.token, response.user);
    } catch (error) {
      throwAuth(error, 'OTP verification failed');
    } finally {
      set({ isLoading: false });
    }
  },

  loginGoogle: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.loginGoogle(payload);
      await get().setSession(response.token, response.user);
    } catch (error) {
      throwAuth(error, 'Google sign-in failed');
    } finally {
      set({ isLoading: false });
    }
  },

  loginApple: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.loginApple(payload);
      await get().setSession(response.token, response.user);
    } catch (error) {
      throwAuth(error, 'Apple sign-in failed');
    } finally {
      set({ isLoading: false });
    }
  },

  forgotPassword: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.forgotPassword(payload);
      return response.message ?? 'Password reset link sent to your email';
    } catch (error) {
      throwAuth(error, 'Failed to send reset link');
    } finally {
      set({ isLoading: false });
    }
  },

  resetPassword: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.resetPassword(payload);
      return response.message ?? 'Password reset successfully';
    } catch (error) {
      throwAuth(error, 'Failed to reset password');
    } finally {
      set({ isLoading: false });
    }
  },

  verifyEmail: async (token) => {
    set({ isLoading: true });
    try {
      const response = await authApi.verifyEmail(token);
      const currentUser = get().user;
      if (currentUser) {
        const updatedUser = { ...currentUser, emailVerified: true };
        await setStoredUser(updatedUser);
        set({ user: updatedUser });
      }
      return response.message ?? 'Email verified successfully';
    } catch (error) {
      throwAuth(error, 'Email verification failed');
    } finally {
      set({ isLoading: false });
    }
  },

  changePassword: async (payload) => {
    set({ isLoading: true });
    try {
      const response = await authApi.changePassword(payload);
      return response.message ?? 'Password changed successfully';
    } catch (error) {
      throwAuth(error, 'Failed to change password');
    } finally {
      set({ isLoading: false });
    }
  },

  resendEmailVerification: async () => {
    set({ isLoading: true });
    try {
      const response = await authApi.resendEmailVerification();
      return response.message ?? 'Verification email sent';
    } catch (error) {
      throwAuth(error, 'Failed to resend verification email');
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await authApi.logout();
    } catch {
      // Clear local session even if server logout fails
    } finally {
      await get().clearSession();
      set({ isLoading: false });
    }
  },

  logoutAll: async () => {
    set({ isLoading: true });
    try {
      await authApi.logoutAll();
    } catch {
      // Clear local session even if server logout fails
    } finally {
      await get().clearSession();
      set({ isLoading: false });
    }
  },

  clearSession: async () => {
    await clearAuthStorage();
    await clearApiSession();
    await clearRestaurantSetupFlag();
    await clearDeliveryPartnerSetupFlag();
    set({ user: null, token: null });
  },

  patchUser: async (partial) => {
    const current = get().user;
    if (!current) return;
    const next: AuthUser = { ...current, ...partial };
    if (partial.id === '') next.id = current.id;
    await setStoredUser(next);
    set({ user: next, role: next.role });
  },
}));
