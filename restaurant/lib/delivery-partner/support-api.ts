import { getMockPartnerSupport } from '@/lib/delivery-partner/support-mock';
import type {
  CreateSupportTicketPayload,
  SupportHubData,
  SupportTicket,
} from '@/lib/delivery-partner/support-types';

/**
 * Set to `false` when partner support APIs are live
 * (e.g. GET/POST /partners/me/support/tickets).
 */
export const USE_MOCK_PARTNER_SUPPORT = true;

/** In-memory ticket store for mock create flow (session only). */
let mockTicketStore: SupportTicket[] | null = null;

function ensureMockTickets(): SupportTicket[] {
  if (!mockTicketStore) {
    mockTicketStore = getMockPartnerSupport().tickets;
  }
  return mockTicketStore;
}

/**
 * Future live endpoints (placeholders):
 * GET  /api/v1/delivery-service/partners/me/support
 * GET  /api/v1/delivery-service/partners/me/support/tickets
 * POST /api/v1/delivery-service/partners/me/support/tickets
 */
export const partnerSupportApi = {
  getHub: async (): Promise<SupportHubData> => {
    if (USE_MOCK_PARTNER_SUPPORT) {
      await new Promise((r) => setTimeout(r, 280));
      const base = getMockPartnerSupport();
      return {
        ...base,
        tickets: [...ensureMockTickets()],
      };
    }

    // When APIs exist, replace with authenticated GET + mapping.
    throw new Error(
      'Support API is not connected yet. Keep USE_MOCK_PARTNER_SUPPORT = true.'
    );
  },

  createTicket: async (
    payload: CreateSupportTicketPayload
  ): Promise<SupportTicket> => {
    const description = payload.description?.trim();
    if (!description) {
      throw new Error('Please describe your issue.');
    }
    if (!payload.issueType) {
      throw new Error('Please select an issue type.');
    }

    if (USE_MOCK_PARTNER_SUPPORT) {
      await new Promise((r) => setTimeout(r, 450));
      const typeLabel =
        payload.issueType.replace(/_/g, ' ').replace(/\b\w/g, (c) =>
          c.toUpperCase()
        ) || 'Support';
      const ticket: SupportTicket = {
        id: `tkt-${Date.now()}`,
        subject: payload.subject?.trim() || `${typeLabel} request`,
        preview: description.slice(0, 120),
        status: 'open',
        issueType: payload.issueType,
        updatedLabel: 'Just now',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      ensureMockTickets().unshift(ticket);
      return ticket;
    }

    throw new Error(
      'Support API is not connected yet. Keep USE_MOCK_PARTNER_SUPPORT = true.'
    );
  },
};
