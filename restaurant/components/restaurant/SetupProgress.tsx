import { Check } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { theme } from '@/constants/theme';

const STEPS = ['Basic Info', 'Address', 'Cuisine'] as const;

type SetupProgressProps = {
  step: number;
  maxStep: number;
  onStep?: (index: number) => void;
};

export function SetupProgress({ step, maxStep, onStep }: SetupProgressProps) {
  return (
    <View className="mb-6">
      <View className="flex-row items-center justify-between">
        {STEPS.map((label, index) => {
          const done = index < step;
          const active = index === step;
          const reachable = index <= maxStep;
          return (
            <View key={label} className="flex-1 items-center">
              <Pressable
                disabled={!reachable || !onStep}
                onPress={() => onStep?.(index)}
                className={`h-8 w-8 items-center justify-center rounded-full ${
                  done ? 'bg-success' : active ? 'bg-primary' : 'bg-gray-200'
                }`}
              >
                {done ? (
                  <Check color="#FFFFFF" size={16} />
                ) : (
                  <Text
                    className={`text-xs font-bold ${
                      active ? 'text-white' : 'text-secondary-light'
                    }`}
                  >
                    {index + 1}
                  </Text>
                )}
              </Pressable>
              <Text
                className={`mt-1.5 text-center text-[10px] font-semibold ${
                  active ? 'text-primary' : 'text-secondary-light'
                }`}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <View
          className="h-full rounded-full bg-primary"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </View>
      <Text className="mt-2 text-xs text-secondary-light">
        Step {step + 1} of {STEPS.length}
      </Text>
    </View>
  );
}

export function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: typeof Check;
  title: string;
}) {
  return (
    <View className="mb-4 flex-row items-center gap-2">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
        <Icon color={theme.primary} size={18} />
      </View>
      <Text className="text-base font-extrabold text-secondary">{title}</Text>
    </View>
  );
}

export function RequiredLabel({ children }: { children: string }) {
  return (
    <Text className="mb-1.5 text-sm font-semibold text-secondary">
      {children}
      <Text className="text-danger"> *</Text>
    </Text>
  );
}
