/**
 * Temporary mock data for Partner Support.
 * Flip `USE_MOCK_PARTNER_SUPPORT` to `false` in support-api.ts when APIs are live.
 */

import type { SupportHubData } from '@/lib/delivery-partner/support-types';

export const MOCK_PARTNER_SUPPORT: SupportHubData = {
  contact: {
    phone: '+9118003354837',
    phoneLabel: '1800-DELIVER',
    phoneHint: '24/7 Available',
    email: 'support@deliverhub.com',
    emailHint: 'Response in 2 hours',
    chatAvailable: true,
    chatHint: 'Avg wait: 2 mins',
  },
  faqs: [
    {
      id: 'faq-accept',
      question: 'How do I accept a delivery order?',
      answer:
        "Go to the Orders section and tap Accept on any available delivery. You'll see the pickup and drop-off locations on the map.",
    },
    {
      id: 'faq-payment',
      question: 'What are the payment methods available?',
      answer:
        'Earnings are settled to your linked bank account or UPI. Tips and incentives appear in the Earnings tab after each completed delivery.',
    },
    {
      id: 'faq-rating',
      question: 'How is my rating calculated?',
      answer:
        'Your rating is based on customer feedback, on-time deliveries, acceptance rate, and cancellation history over recent trips.',
    },
    {
      id: 'faq-cant-complete',
      question: "What should I do if I can't complete a delivery?",
      answer:
        'Use Reject or contact support from this screen with the order id. Never leave food unattended — follow the in-app cancellation steps.',
    },
    {
      id: 'faq-earnings',
      question: 'How can I increase my earnings?',
      answer:
        'Stay online during peak hours, keep a high acceptance rate, and complete incentive programs shown on Analytics and Earnings.',
    },
    {
      id: 'faq-charges',
      question: 'Are there any hidden charges?',
      answer:
        'No hidden charges. Deductions (if any) are listed clearly under Earnings as tips, incentives, or adjustments from the delivery service.',
    },
  ],
  resources: [
    { id: 'res-video', title: 'Video Tutorials', kind: 'training' },
    { id: 'res-start', title: 'Getting Started Guide', kind: 'training' },
    { id: 'res-nav', title: 'Navigation Tips', kind: 'training' },
    { id: 'res-best', title: 'Best Practices', kind: 'training' },
    { id: 'res-earn', title: 'Earn More Guide', kind: 'training' },
    { id: 'doc-terms', title: 'Terms & Conditions', kind: 'document' },
    { id: 'doc-privacy', title: 'Privacy Policy', kind: 'document' },
    { id: 'doc-partner', title: 'Partner Agreement', kind: 'document' },
    { id: 'doc-cancel', title: 'Cancellation Policy', kind: 'document' },
  ],
  tickets: [
    {
      id: 'tkt-1',
      subject: 'Delivery Issue - Order DH001',
      preview: 'Thanks for your help! Issue resolved.',
      status: 'resolved',
      updatedLabel: '2 hours ago',
      issueType: 'delivery_issue',
    },
    {
      id: 'tkt-2',
      subject: 'Payment Not Received',
      preview: 'Your payment will be processed by tomorrow.',
      status: 'in_progress',
      updatedLabel: '1 day ago',
      issueType: 'payment',
    },
    {
      id: 'tkt-3',
      subject: 'Account Verification',
      preview: 'Your documents have been verified successfully!',
      status: 'resolved',
      updatedLabel: '3 days ago',
      issueType: 'account',
    },
  ],
};

export function getMockPartnerSupport(): SupportHubData {
  return {
    ...MOCK_PARTNER_SUPPORT,
    tickets: [...MOCK_PARTNER_SUPPORT.tickets],
    faqs: [...MOCK_PARTNER_SUPPORT.faqs],
    resources: [...MOCK_PARTNER_SUPPORT.resources],
    contact: { ...MOCK_PARTNER_SUPPORT.contact },
  };
}
