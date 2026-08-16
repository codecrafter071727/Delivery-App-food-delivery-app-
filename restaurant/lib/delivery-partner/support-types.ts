/**
 * Delivery partner support — types for tickets / FAQ / contact.
 * Screen uses mock data until support APIs ship
 * (`USE_MOCK_PARTNER_SUPPORT` in support-api.ts).
 */

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | string;

export type SupportIssueType =
  | 'delivery_issue'
  | 'payment'
  | 'account'
  | 'app_bug'
  | 'other'
  | string;

export type SupportTicket = {
  id: string;
  subject: string;
  preview?: string;
  status: SupportTicketStatus;
  issueType?: SupportIssueType;
  createdAt?: string;
  updatedAt?: string;
  /** Relative label from API or mock, e.g. "2 hours ago" */
  updatedLabel?: string;
};

export type SupportFaqItem = {
  id: string;
  question: string;
  answer: string;
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

export const SUPPORT_ISSUE_TYPE_OPTIONS: {
  value: SupportIssueType;
  label: string;
}[] = [
  { value: 'delivery_issue', label: 'Delivery issue' },
  { value: 'payment', label: 'Payment & earnings' },
  { value: 'account', label: 'Account / documents' },
  { value: 'app_bug', label: 'App bug' },
  { value: 'other', label: 'Other' },
];
