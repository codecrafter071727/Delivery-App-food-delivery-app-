import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand } from '@/components/auth/Brand';
import { cardShadow, theme } from '@/constants/theme';

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  showBack?: boolean;
  onBackPress?: () => void;
};

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  showBack,
  onBackPress,
}: AuthShellProps) {
  const router = useRouter();

  return (
    <View className="flex-1 bg-surface">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SafeAreaView edges={['top', 'bottom']}>
            <View className="items-center mt-6 mb-2">
              <Brand portal={false} />
            </View>
            <View
              className="mx-4 mb-6 rounded-3xl border border-gray-100 bg-white px-6 py-7"
              style={cardShadow}
            >
              {showBack ? (
                <Pressable
                  onPress={onBackPress ?? (() => router.back())}
                  hitSlop={10}
                  className="mb-4 h-9 w-9 items-center justify-center rounded-full bg-surface"
                >
                  <ArrowLeft color={theme.secondary} size={18} />
                </Pressable>
              ) : null}


              <Text className="mt-5 text-2xl font-extrabold text-secondary">
                {title}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-secondary-light">
                {subtitle}
              </Text>

              <View className="mt-6">{children}</View>

              {footer ? <View className="mt-6">{footer}</View> : null}
            </View>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
