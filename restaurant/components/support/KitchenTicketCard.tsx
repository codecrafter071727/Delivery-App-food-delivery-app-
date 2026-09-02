import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  TICKET_STAGE_STEPS,
  type KitchenSupportTicket,
  type KitchenTicketRemark,
  type KitchenTicketStage,
} from '@/lib/restaurant/support-types';

const STAGE_ORDER: KitchenTicketStage[] = ['initiated', 'working', 'closed'];

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Progress({ stage }: { stage: KitchenTicketStage }) {
  const current = Math.max(0, STAGE_ORDER.indexOf(stage));
  return (
    <View style={styles.progress}>
      {TICKET_STAGE_STEPS.map((step, i) => {
        const done = i <= current;
        const last = i === TICKET_STAGE_STEPS.length - 1;
        return (
          <View key={step.id} style={styles.progressStep}>
            <View style={styles.progressCol}>
              <View style={[styles.dot, done && styles.dotOn]} />
              <Text style={[styles.stepLabel, done && styles.stepLabelOn]}>
                {step.label}
              </Text>
            </View>
            {last ? null : (
              <View style={[styles.bar, i < current && styles.barOn]} />
            )}
          </View>
        );
      })}
    </View>
  );
}

type TimelineItem = {
  id: string;
  title: string;
  text: string;
  at: string;
};

function buildTimeline(ticket: KitchenSupportTicket): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: 'opened',
      title: 'Initiated',
      text: ticket.description || 'Ticket opened with support.',
      at: ticket.createdAt,
    },
  ];

  for (const remark of ticket.remarks) {
    const role =
      remark.authorRole === 'restaurant'
        ? 'You'
        : remark.authorName ||
          (remark.authorRole === 'system' ? 'System' : 'Support');
    items.push({
      id: remark.id,
      title: role,
      text: remark.text,
      at: remark.createdAt,
    });
  }

  if (ticket.stage === 'closed') {
    const alreadyClosed = ticket.remarks.some((r) =>
      /closed|resolved/i.test(r.text)
    );
    if (!alreadyClosed) {
      items.push({
        id: 'closed',
        title: 'Closed',
        text: ticket.latestRemark || 'Ticket closed.',
        at: ticket.updatedAt || ticket.createdAt,
      });
    }
  }

  return items;
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineDot} />
        <View style={styles.timelineLine} />
      </View>
      <View style={styles.timelineBody}>
        <Text style={styles.remarkMeta}>
          {item.title} · {formatDate(item.at)}
        </Text>
        <Text style={styles.remarkText}>{item.text}</Text>
      </View>
    </View>
  );
}

function RemarkRow({ remark }: { remark: KitchenTicketRemark }) {
  const who =
    remark.authorName ||
    (remark.authorRole === 'system' ? 'Support' : 'TOKAJO');
  return (
    <View style={styles.remark}>
      <Text style={styles.remarkMeta}>
        {who} · {formatDate(remark.createdAt)}
      </Text>
      <Text style={styles.remarkText}>{remark.text}</Text>
    </View>
  );
}

export function KitchenTicketCard({
  ticket,
  expanded = false,
  onPress,
}: {
  ticket: KitchenSupportTicket;
  expanded?: boolean;
  onPress?: () => void;
}) {
  const timeline = buildTimeline(ticket);
  const previewRemarks = ticket.remarks.slice(-2);

  const body = (
    <>
      <View style={styles.cardTop}>
        <Text style={styles.ticketNo}>{ticket.ticketNo || ticket.ticketId}</Text>
        <Text style={styles.priority}>{ticket.priority}</Text>
      </View>
      <Text style={styles.subject}>{ticket.subject}</Text>
      <Text style={styles.body} numberOfLines={expanded ? undefined : 3}>
        {ticket.description}
      </Text>
      <Text style={styles.meta}>
        {ticket.category} · {formatDate(ticket.createdAt)}
      </Text>
      <Progress stage={ticket.stage} />

      {expanded ? (
        <View style={styles.remarks}>
          <Text style={styles.remarksTitle}>Timeline</Text>
          {timeline.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </View>
      ) : previewRemarks.length > 0 ? (
        <View style={styles.remarks}>
          <Text style={styles.remarksTitle}>Latest remarks</Text>
          {previewRemarks.map((r) => (
            <RemarkRow key={r.id} remark={r} />
          ))}
        </View>
      ) : (
        <Text style={styles.noRemark}>
          {onPress ? 'Tap for full timeline' : 'No remarks yet from support.'}
        </Text>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.card}>
        {body}
      </Pressable>
    );
  }

  return <View style={styles.card}>{body}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 14,
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  ticketNo: { color: authTheme.brand, fontSize: 12, fontFamily: fonts.bold },
  priority: { color: authTheme.textDim, fontSize: 11, fontFamily: fonts.semiBold },
  subject: { color: authTheme.text, fontSize: 15, fontFamily: fonts.bold },
  body: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    lineHeight: 18,
  },
  meta: { color: authTheme.textDim, fontSize: 12, fontFamily: fonts.medium },
  progress: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  progressStep: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  progressCol: { alignItems: 'center', gap: 4, minWidth: 64 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(15,23,42,0.15)',
  },
  dotOn: { backgroundColor: authTheme.brand },
  bar: {
    flex: 1,
    height: 1,
    marginBottom: 16,
    backgroundColor: 'rgba(15,23,42,0.12)',
  },
  barOn: { backgroundColor: authTheme.brand },
  stepLabel: {
    color: authTheme.textDim,
    fontSize: 10,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  stepLabelOn: { color: authTheme.text, fontFamily: fonts.semiBold },
  remarks: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(122, 14, 34, 0.06)',
    gap: 8,
  },
  remarksTitle: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
  },
  remark: { gap: 2 },
  remarkMeta: { color: authTheme.textDim, fontSize: 11, fontFamily: fonts.medium },
  remarkText: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.medium,
    lineHeight: 18,
  },
  noRemark: { color: authTheme.textDim, fontSize: 12, fontFamily: fonts.medium },
  timelineRow: { flexDirection: 'row', gap: 10, minHeight: 44 },
  timelineRail: { width: 14, alignItems: 'center' },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    backgroundColor: authTheme.brand,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    marginTop: 4,
    backgroundColor: 'rgba(122, 14, 34, 0.15)',
  },
  timelineBody: { flex: 1, gap: 2, paddingBottom: 10 },
});
