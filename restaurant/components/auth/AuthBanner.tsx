import { CheckCircle2, XCircle } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { theme } from '@/constants/theme';

type AuthBannerProps = {
  type: 'error' | 'success';
  message?: string | null;
};

export function AuthBanner({ type, message }: AuthBannerProps) {
  if (!message) return null;

  const isError = type === 'error';
  const Icon = isError ? XCircle : CheckCircle2;

  return (
    <View
      className={`mb-4 flex-row items-start gap-2.5 rounded-2xl border p-3.5 ${
        isError
          ? 'border-danger/30 bg-danger/10'
          : 'border-success/30 bg-success/10'
      }`}
    >
      <Icon color={isError ? theme.danger : theme.success} size={20} />
      <Text
        className={`flex-1 text-sm font-medium ${
          isError ? 'text-danger' : 'text-success'
        }`}
      >
        {message}
      </Text>
    </View>
  );
}
