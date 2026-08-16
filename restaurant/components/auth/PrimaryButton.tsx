import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { buttonGradient, theme } from '@/constants/theme';

const BUTTON_HEIGHT = 52;
const BORDER_RADIUS = 12;

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  variant?: 'solid' | 'outline';
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  icon: Icon,
  trailingIcon: TrailingIcon,
  variant = 'solid',
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const outline = variant === 'outline';
  const tint = outline ? theme.primary : '#FFFFFF';

  const content = loading ? (
    <ActivityIndicator color={tint} />
  ) : (
    <View style={styles.content}>
      {Icon ? <Icon color={tint} size={18} /> : null}
      <Text style={[styles.label, outline && styles.labelOutline]}>{label}</Text>
      {TrailingIcon ? <TrailingIcon color={tint} size={18} /> : null}
    </View>
  );

  if (outline) {
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.buttonBase,
          styles.outline,
          isDisabled && styles.disabled,
          pressed && !isDisabled && styles.outlinePressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.buttonBase,
        styles.solidShadow,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.solidPressed,
      ]}
    >
      <LinearGradient
        colors={[...buttonGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.gradient}
      >
        {content}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    width: '100%',
    height: BUTTON_HEIGHT,
    borderRadius: BORDER_RADIUS,
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
    width: '100%',
    height: BUTTON_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  labelOutline: {
    color: theme.primary,
  },
  outline: {
    borderWidth: 2,
    borderColor: theme.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlinePressed: {
    backgroundColor: 'rgba(158, 27, 50, 0.06)',
  },
  solidShadow: {
    shadowColor: '#6E0F1B',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  solidPressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.6,
  },
});
