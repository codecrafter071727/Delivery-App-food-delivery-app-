/**
 * Delivery partner support — tickets / FAQ / contact.
 * Live paths under /api/v1/delivery-service/partners/me/support/*
 */

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_partner'
  | 'resolved'
  | 'closed'
  | string;

/** API ticket categories (earnings/payout need deliveryId or payoutId). */
export type SupportIssueType =
  | 'cod_issue'
  | 'app_bug'
  | 'account_issue'
  | 'kyc_issue'
  | 'incentive_issue'
  | 'other'
  | string;

export type SupportMessageRole = 'partner' | 'agent' | 'system' | string;

export type SupportTicketMessage = {
  messageId: string;
  senderRole: SupportMessageRole;
  senderUserId?: string | null;
  authorName?: string | null;
  text: string;
  attachments?: string[];
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  ticketNo?: string;
  subject: string;
  preview?: string;
  status: SupportTicketStatus;
  issueType?: SupportIssueType;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string | null;
  /** Relative label, e.g. "2 hours ago" */
  updatedLabel?: string;
};

export type SupportTicketDetail = SupportTicket & {
  description: string;
  attachments: string[];
  messages: SupportTicketMessage[];
  resolution: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
};

export type SupportFaqItem = {
  id: string;
  question: string;
  answer: string;
  category?: string;
};

export type SupportResource = {
  id: string;
  title: string;
  url?: string;
  kind: 'training' | 'document';
};

export type SupportContactInfo = {
  phone?: string;
  phoneLabel?: string;
  phoneHint?: string;
  email?: string;
  emailHint?: string;
  chatAvailable?: boolean;
  chatHint?: string;
};

export type SupportHubData = {
  contact: SupportContactInfo;
  faqs: SupportFaqItem[];
  resources: SupportResource[];
  tickets: SupportTicket[];
};

export type CreateSupportTicketPayload = {
  issueType: SupportIssueType;
  description: string;
  /** Local image URI when attached */
  screenshotUri?: string | null;
  subject?: string;
};

export type AddSupportTicketMessagePayload = {
  text: string;
  screenshotUri?: string | null;
};

export const SUPPORT_ISSUE_TYPE_OPTIONS: {
  value: SupportIssueType;
  label: string;
}[] = [
  { value: 'cod_issue', label: 'COD / cash' },
  { value: 'incentive_issue', label: 'Incentives & earnings' },
  { value: 'account_issue', label: 'Account' },
  { value: 'kyc_issue', label: 'KYC / documents' },
  { value: 'app_bug', label: 'App bug' },
  { value: 'other', label: 'Other' },
];
