import type { OrdersHourPoint, RevenuePoint } from '@/lib/analytics/types';
import { authTheme } from '@/constants/auth-theme';
import Svg, { Circle, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/typography';

type TrendChartProps = {
  points: RevenuePoint[];
  width: number;
  height?: number;
};

export function RevenueTrendChart({
  points,
  width,
  height = 180,
}: TrendChartProps) {
  if (!points.length || width <= 0) return null;

  const padX = 12;
  const padTop = 16;
  const padBottom = 28;
  const chartW = Math.max(width - padX * 2, 1);
  const chartH = height - padTop - padBottom;
  const values = points.map((p) => Math.max(p.revenue, p.orders));
  const max = Math.max(...values, 1);

  const coords = points.map((point, index) => {
    const x =
      points.length === 1
        ? padX + chartW / 2
        : padX + (index / (points.length - 1)) * chartW;
    const y = padTop + chartH - (Math.max(point.revenue, 0) / max) * chartH;
    return { x, y, label: point.label };
  });

  const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const area =
    `${padX},${padTop + chartH} ` +
    coords.map((c) => `${c.x},${c.y}`).join(' ') +
    ` ${padX + chartW},${padTop + chartH}`;

  const labelStep = Math.max(1, Math.ceil(points.length / 5));

  return (
    <Svg width={width} height={height}>
      <Path d={`M ${area}`} fill="rgba(122, 14, 34, 0.08)" />
      <Polyline
        points={line}
        fill="none"
        stroke={authTheme.brand}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {coords.map((c, index) => (
        <Circle
          key={`dot-${index}`}
          cx={c.x}
          cy={c.y}
          r={3.5}
          fill="#FFFFFF"
          stroke={authTheme.brand}
          strokeWidth={2}
        />
      ))}
      {coords.map((c, index) =>
        index % labelStep === 0 || index === coords.length - 1 ? (
          <SvgText
            key={`label-${index}`}
            x={c.x}
            y={height - 8}
            fill={authTheme.textMuted}
            fontSize="10"
            textAnchor="middle"
          >
            {c.label}
          </SvgText>
        ) : null
      )}
    </Svg>
  );
}

type PieSlice = {
  name: string;
  percent: number;
  color: string;
};

type PieChartProps = {
  slices: PieSlice[];
  size?: number;
};

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
) {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y} Z`;
}

export function CategoryPieChart({ slices, size = 140 }: PieChartProps) {
  if (!slices.length) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  let angle = 0;

  return (
    <Svg width={size} height={size}>
      {slices.map((slice, index) => {
        const sweep = Math.max((slice.percent / 100) * 360, 0.5);
        const start = angle;
        const end = angle + sweep;
        angle = end;
        if (slices.length === 1) {
          return (
            <Circle
              key={`${slice.name}-${index}`}
              cx={cx}
              cy={cy}
              r={r}
              fill={slice.color}
            />
          );
        }
        return (
          <Path
            key={`${slice.name}-${index}`}
            d={arcPath(cx, cy, r, start, end)}
            fill={slice.color}
          />
        );
      })}
      <Circle cx={cx} cy={cy} r={r * 0.52} fill="#FFFFFF" />
    </Svg>
  );
}

function formatHourTick(hour: number) {
  const suffix = hour >= 12 ? 'p' : 'a';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

export function HourDemandChart({ hours }: { hours: OrdersHourPoint[] }) {
  const max = Math.max(...hours.map((row) => row.count), 0);
  const peak = hours.reduce(
    (best, row) => (row.count > best.count ? row : best),
    hours[0] ?? { hour: 0, count: 0, revenue: 0 }
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={hourStyles.row}
    >
      {hours.map((row) => {
        const height = max > 0 ? Math.max((row.count / max) * 112, row.count > 0 ? 4 : 2) : 2;
        const isPeak = peak.count > 0 && row.hour === peak.hour;
        return (
          <View key={row.hour} style={hourStyles.col}>
            <View
              style={[
                hourStyles.bar,
                {
                  height,
                  backgroundColor: isPeak
                    ? authTheme.brand
                    : row.count > 0
                      ? 'rgba(122, 14, 34, 0.28)'
                      : 'rgba(122, 14, 34, 0.08)',
                },
              ]}
            />
            {row.hour % 3 === 0 ? (
              <Text style={hourStyles.tick}>{formatHourTick(row.hour)}</Text>
            ) : (
              <View style={hourStyles.tickSpacer} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const hourStyles = StyleSheet.create({
  row: {
    alignItems: 'flex-end',
    minHeight: 140,
    paddingTop: 8,
    gap: 5,
  },
  col: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  bar: {
    width: 10,
    borderRadius: 4,
  },
  tick: {
    color: authTheme.textMuted,
    fontSize: 9,
    fontFamily: fonts.medium,
  },
  tickSpacer: {
    height: 12,
  },
});
