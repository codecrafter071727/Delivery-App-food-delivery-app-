import type {
  SupportFaqItem,
  SupportIssueType,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketMessage,
} from '@/lib/delivery-partner/support-types';
import { SUPPORT_ISSUE_TYPE_OPTIONS } from '@/lib/delivery-partner/support-types';

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function formatRelative(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function mapCategory(issueType: SupportIssueType): string {
  const allowed = new Set(SUPPORT_ISSUE_TYPE_OPTIONS.map((o) => o.value));
  if (allowed.has(issueType)) return String(issueType);
  if (issueType === 'payment' || issueType === 'delivery_issue') return 'other';
  if (issueType === 'account') return 'account_issue';
  return 'other';
}

export function categoryLabel(category: string): string {
  return (
    SUPPORT_ISSUE_TYPE_OPTIONS.find((o) => o.value === category)?.label ||
    category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function mapMessage(raw: Record<string, unknown>): SupportTicketMessage | null {
  const messageId = String(raw.messageId ?? raw._id ?? raw.id ?? '').trim();
  const text = String(raw.text ?? '').trim();
  if (!messageId && !text) return null;
  return {
    messageId: messageId || `msg-${raw.createdAt ?? Date.now()}`,
    senderRole: String(raw.senderRole ?? 'system'),
    senderUserId: raw.senderUserId ? String(raw.senderUserId) : null,
    authorName: raw.authorName ? String(raw.authorName) : null,
    text,
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map(String)
      : [],
    createdAt: String(raw.createdAt ?? ''),
  };
}

export function mapTicket(raw: Record<string, unknown>): SupportTicket | null {
  const id = String(raw.ticketId ?? raw._id ?? raw.id ?? '').trim();
  if (!id) return null;
  const lastMessageAt = raw.lastMessageAt ? String(raw.lastMessageAt) : null;
  const updatedAt = raw.updatedAt ? String(raw.updatedAt) : undefined;
  const messages = Array.isArray(raw.messages)
    ? (raw.messages
        .map((row) => mapMessage(asRecord(row) ?? {}))
        .filter(Boolean) as SupportTicketMessage[])
    : [];
  const lastText =
    messages.length > 0
      ? messages[messages.length - 1]?.text
      : raw.description
        ? String(raw.description)
        : undefined;
  return {
    id,
    ticketNo: raw.ticketNo ? String(raw.ticketNo) : undefined,
    subject: String(raw.subject ?? 'Support ticket'),
    preview: lastText?.slice(0, 120),
    status: String(raw.status ?? 'open'),
    issueType: String(raw.category ?? raw.issueType ?? 'other'),
    priority: raw.priority ? String(raw.priority) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    updatedAt,
    lastMessageAt,
    updatedLabel: formatRelative(lastMessageAt || updatedAt),
  };
}

export function mapDetail(raw: Record<string, unknown>): SupportTicketDetail | null {
  const base = mapTicket(raw);
  if (!base) return null;
  const messages = Array.isArray(raw.messages)
    ? (raw.messages
        .map((row) => mapMessage(asRecord(row) ?? {}))
        .filter(Boolean) as SupportTicketMessage[])
    : [];
  return {
    ...base,
    description: String(raw.description ?? ''),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map(String)
      : [],
    messages,
    resolution: raw.resolution ? String(raw.resolution) : null,
    resolvedAt: raw.resolvedAt ? String(raw.resolvedAt) : null,
    closedAt: raw.closedAt ? String(raw.closedAt) : null,
  };
}

export function unwrapListPayload(payload: unknown): unknown[] {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data) ?? root;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(root.data)) return root.data as unknown[];
  if (Array.isArray(payload)) return payload;
  return [];
}

export function mapFaq(raw: Record<string, unknown>): SupportFaqItem | null {
  const id = String(raw.id ?? '').trim();
  const question = String(raw.title ?? raw.question ?? '').trim();
  const answer = String(raw.body ?? raw.answer ?? '').trim();
  if (!id || !question) return null;
  return {
    id,
    question,
    answer,
    category: raw.category ? String(raw.category) : undefined,
  };
}
