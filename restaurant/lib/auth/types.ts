/** Partner role selected at the top of the auth screens. */
export type PartnerRole = 'restaurant' | 'delivery';

/** Role values accepted by the user-service auth API. */
export type ApiRole = 'restaurant_owner' | 'delivery_partner';

export function toApiRole(role: PartnerRole): ApiRole {
  return role === 'delivery' ? 'delivery_partner' : 'restaurant_owner';
}

export function fromApiRole(value: unknown, fallback: PartnerRole): PartnerRole {
  const raw = String(value ?? '').toLowerCase();
  if (
    raw === 'delivery_partner' ||
    raw === 'delivery' ||
    raw.includes('rider') ||
    raw.includes('driver')
  ) {
    return 'delivery';
  }
  if (
    raw === 'restaurant_owner' ||
    raw === 'restaurant' ||
    raw.includes('vendor') ||
    raw.includes('merchant')
  ) {
    return 'restaurant';
  }
  return fallback;
}

export const PARTNER_ROLES: {
  value: PartnerRole;
  label: string;
  caption: string;
}[] = [
  {
    value: 'restaurant',
    label: 'Restaurant',
    caption: 'Manage orders & menu',
  },
  {
    value: 'delivery',
    label: 'Delivery Partner',
    caption: 'Pick up & deliver',
  },
];

export type AuthUser = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role: PartnerRole;
  emailVerified?: boolean;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
  message?: string;
};

export type RegisterPayload = {
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
  role: PartnerRole;
};

export type LoginPayload = {
  email: string;
  password: string;
  role: PartnerRole;
};

export type OtpPurpose =
  | 'login'
  | 'register'
  | 'forgot_password'
  | 'verification'
  | 'update_phone'
  | 'delete_account';

export type OtpSendPayload = {
  emailOrPhone: string;
  purpose?: OtpPurpose;
};

export type OtpSendResult = {
  message: string;
  cooldownSeconds: number;
};

export type OtpVerifyPayload = {
  emailOrPhone: string;
  otp: string;
  role: PartnerRole;
  purpose?: OtpPurpose;
};

export type GoogleLoginPayload = {
  idToken: string;
  role: PartnerRole;
};

export type AppleLoginPayload = {
  identityToken: string;
  authorizationCode?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role: PartnerRole;
};

export type ForgotPasswordPayload = {
  email: string;
};

export type ResetPasswordPayload = {
  token: string;
  password: string;
  confirmPassword?: string;
};

export type ChangePasswordPayload = {
  oldPassword: string;
  newPassword: string;
  confirmPassword?: string;
};

export type MessageResponse = {
  message: string;
};
