import type { LucideIcon } from 'lucide-react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { theme } from '@/constants/theme';

/**
 * Maps to iOS textContentType + Android autoComplete so Google / Apple
 * Password Manager can suggest and save credentials.
 */
export type AuthAutofill =
  | 'email'
  | 'username'
  | 'password'
  | 'newPassword'
  | 'currentPassword'
  | 'oneTimeCode'
  | 'givenName'
  | 'familyName'
  | 'name'
  | 'telephone'
  | 'off';

type AuthFieldProps = TextInputProps & {
  label: string;
  icon?: LucideIcon;
  secure?: boolean;
  errorText?: string;
  /** Right-aligned element on the label row (e.g. a "Forgot?" link). */
  labelAccessory?: ReactNode;
  /** Password-manager / autofill hint for restaurant + delivery auth. */
  autofill?: AuthAutofill;
};

function autofillProps(kind?: AuthAutofill): Partial<TextInputProps> {
  if (!kind || kind === 'off') {
    return {
      autoComplete: 'off',
      textContentType: 'none',
      importantForAutofill: 'no',
    };
  }

  switch (kind) {
    case 'email':
      return {
        autoComplete: 'email',
        textContentType: 'emailAddress',
        keyboardType: 'email-address',
        autoCapitalize: 'none',
        autoCorrect: false,
        importantForAutofill: 'yes',
      };
    case 'username':
      return {
        autoComplete: 'username',
        textContentType: 'username',
        autoCapitalize: 'none',
        autoCorrect: false,
        importantForAutofill: 'yes',
      };
    case 'password':
      return {
        autoComplete: 'password',
        textContentType: 'password',
        autoCapitalize: 'none',
        autoCorrect: false,
        importantForAutofill: 'yes',
      };
    case 'newPassword':
      return {
        autoComplete: 'password-new',
        textContentType: 'newPassword',
        autoCapitalize: 'none',
        autoCorrect: false,
        passwordRules:
          'minlength: 6; required: lower; required: upper; required: digit;',
        importantForAutofill: 'yes',
      };
    case 'currentPassword':
      return {
        autoComplete: 'password',
        textContentType: 'password',
        autoCapitalize: 'none',
        autoCorrect: false,
        importantForAutofill: 'yes',
      };
    case 'oneTimeCode':
      return {
        autoComplete: 'one-time-code',
        textContentType: 'oneTimeCode',
        keyboardType: 'number-pad',
        importantForAutofill: 'yes',
      };
    case 'givenName':
      return {
        autoComplete: 'given-name',
        textContentType: 'givenName',
        autoCapitalize: 'words',
        importantForAutofill: 'yes',
      };
    case 'familyName':
      return {
        autoComplete: 'family-name',
        textContentType: 'familyName',
        autoCapitalize: 'words',
        importantForAutofill: 'yes',
      };
    case 'name':
      return {
        autoComplete: 'name',
        textContentType: 'name',
        autoCapitalize: 'words',
        importantForAutofill: 'yes',
      };
    case 'telephone':
      return {
        autoComplete: 'tel',
        textContentType: 'telephoneNumber',
        keyboardType: 'phone-pad',
        importantForAutofill: 'yes',
      };
    default:
      return {};
  }
}

export function AuthField({
  label,
  icon: Icon,
  secure,
  errorText,
  labelAccessory,
  autofill,
  onFocus,
  onBlur,
  ...inputProps
}: AuthFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secure));

  const hasError = Boolean(errorText);
  const managerProps = useMemo(() => autofillProps(autofill), [autofill]);

  return (
    <View className="mb-4">
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-secondary">{label}</Text>
        {labelAccessory}
      </View>
      <View
        className={`h-12 flex-row items-center rounded-xl border px-3.5 ${
          hasError
            ? 'border-danger bg-danger/5'
            : focused
              ? 'border-primary bg-white'
              : 'border-gray-200 bg-white'
        }`}
      >
        {Icon ? (
          <Icon
            color={hasError ? theme.danger : focused ? theme.primary : theme.muted}
            size={18}
          />
        ) : null}
        <TextInput
          className="flex-1 pl-2.5 text-[15px] text-secondary"
          placeholderTextColor={theme.muted}
          {...managerProps}
          {...inputProps}
          secureTextEntry={secure ? hidden : inputProps.secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {secure ? (
          <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10}>
            {hidden ? (
              <EyeOff color={theme.muted} size={18} />
            ) : (
              <Eye color={theme.primary} size={18} />
            )}
          </Pressable>
        ) : null}
      </View>
      {hasError ? (
        <Text className="mt-1 text-xs font-medium text-danger">{errorText}</Text>
      ) : null}
    </View>
  );
}
