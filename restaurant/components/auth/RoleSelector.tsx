import { Pressable, Text, View } from 'react-native';

import { PARTNER_ROLES, type PartnerRole } from '@/lib/auth/types';

type RoleSelectorProps = {
  value: PartnerRole;
  onChange: (role: PartnerRole) => void;
  disabled?: boolean;
};

export function RoleSelector({ value, onChange, disabled }: RoleSelectorProps) {
  return (
    <View className="mb-5 flex-row rounded-2xl bg-surface p-1">
      {PARTNER_ROLES.map((role) => {
        const active = value === role.value;
        return (
          <Pressable
            key={role.value}
            disabled={disabled}
            onPress={() => onChange(role.value)}
            className={`flex-1 items-center justify-center rounded-xl py-2.5 ${
              active ? 'bg-white' : ''
            }`}
            style={
              active
                ? {
                    shadowColor: '#111827',
                    shadowOpacity: 0.1,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 2,
                  }
                : undefined
            }
          >
            <Text
              className={`text-sm ${
                active
                  ? 'font-bold text-secondary'
                  : 'font-semibold text-secondary-light'
              }`}
            >
              {role.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
