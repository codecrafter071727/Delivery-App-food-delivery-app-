import axios from 'axios';

import { api, assertApiBaseUrl } from '@/lib/api';
import { PartnerApiError } from '@/lib/errors';
import { postMultipartWithFields } from '@/lib/multipart-upload';
import {
  asRecord,
  categoryLabel,
  mapCategory,
  mapDetail,
  mapFaq,
  mapTicket,
  unwrapListPayload,
} from '@/lib/delivery-partner/support-map';
import type {
  AddSupportTicketMessagePayload,
  CreateSupportTicketPayload,
  SupportFaqItem,
  SupportHubData,
  SupportTicket,
  SupportTicketDetail,
} from '@/lib/delivery-partner/support-types';

/** Production path — never flip back to mock. */
export const USE_MOCK_PARTNER_SUPPORT = false;

const ME = '/api/v1/delivery-service/partners/me/support';

const STATIC_CONTACT: SupportHubData['contact'] = {
  phone: '+911800000000',
  phoneLabel: 'Request callback',
  phoneHint: 'Ops will call you back',
  email: 'support@tokajo.com',
  emailHint: 'Usually within a few hours',
  chatAvailable: false,
  chatHint: 'Use tickets for written help',
};

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  code?: string;
};

function throwSupportError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      throw new PartnerApiError(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const code = data?.code;
    const message =
      data?.message || data?.error || `Request failed (${error.response.status})`;
    if (message.toLowerCase().includes('csrf')) {
      throw new PartnerApiError(
        'Security token expired. Close and reopen the app, then try again.',
        code
      );
    }
    throw new PartnerApiError(
      code ? `${message} (${code})` : message,
      code
    );
  }
  if (error instanceof Error) throw error;
  throw new PartnerApiError(fallback);
}

function attachmentFile(uri: string, name: string) {
  return {
    fieldName: 'attachment' as const,
    file: { uri, name, type: 'image/jpeg' },
  };
}

export const partnerSupportApi = {
  listFaq: async (params?: {
    category?: string;
    q?: string;
  }): Promise<SupportFaqItem[]> => {
    assertApiBaseUrl();
    try {
      const res = await api.get<Envelope<{ items?: unknown[] }>>(
        `${ME}/faq`,
        { params }
      );
      const data = asRecord(res.data?.data) ?? asRecord(res.data) ?? {};
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(res.data?.data)
          ? (res.data.data as unknown[])
          : [];
      return items
        .map((row) => mapFaq(asRecord(row) ?? {}))
        .filter(Boolean) as SupportFaqItem[];
    } catch (error) {
      throwSupportError(error, 'Failed to load FAQ');
    }
  },

  listTickets: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<SupportTicket[]> => {
    assertApiBaseUrl();
    try {
      const res = await api.get(`${ME}/tickets`, {
        params: {
          page: params?.page ?? 1,
          limit: params?.limit ?? 20,
          ...(params?.status ? { status: params.status } : {}),
        },
      });
      return unwrapListPayload(res.data)
        .map((row) => mapTicket(asRecord(row) ?? {}))
        .filter(Boolean) as SupportTicket[];
    } catch (error) {
      throwSupportError(error, 'Failed to load support tickets');
    }
  },

  getTicket: async (ticketId: string): Promise<SupportTicketDetail> => {
    assertApiBaseUrl();
    try {
      const res = await api.get<Envelope<unknown>>(`${ME}/tickets/${ticketId}`);
      const mapped = mapDetail(asRecord(res.data?.data) ?? {});
      if (!mapped) throw new PartnerApiError('Ticket not found', 'TICKET_NOT_FOUND');
      return mapped;
    } catch (error) {
      throwSupportError(error, 'Failed to load ticket');
    }
  },

  getHub: async (): Promise<SupportHubData> => {
    assertApiBaseUrl();
    const [faqs, tickets] = await Promise.all([
      partnerSupportApi.listFaq().catch(() => [] as SupportFaqItem[]),
      partnerSupportApi.listTickets({ page: 1, limit: 30 }),
    ]);
    return {
      contact: STATIC_CONTACT,
      faqs,
      resources: [],
      tickets,
    };
  },

  createTicket: async (
    payload: CreateSupportTicketPayload
  ): Promise<SupportTicket> => {
    const description = payload.description?.trim() ?? '';
    if (description.length < 10) {
      throw new PartnerApiError(
        'Describe the issue in at least 10 characters.',
        'INVALID_TICKET'
      );
    }
    if (!payload.issueType) {
      throw new PartnerApiError('Please select an issue type.', 'INVALID_TICKET');
    }

    const category = mapCategory(payload.issueType);
    const subject = (
      payload.subject?.trim() || `${categoryLabel(category)} request`
    ).slice(0, 200);
    if (subject.length < 5) {
      throw new PartnerApiError(
        'Subject must be at least 5 characters.',
        'INVALID_TICKET'
      );
    }

    assertApiBaseUrl();
    try {
      let raw: Record<string, unknown> | null = null;
      if (payload.screenshotUri) {
        raw = await postMultipartWithFields(`${ME}/tickets`, {
          fields: { category, subject, description },
          files: [attachmentFile(payload.screenshotUri, 'support-screenshot.jpg')],
        });
      } else {
        const res = await api.post<Envelope<unknown>>(`${ME}/tickets`, {
          category,
          subject,
          description,
        });
        raw = asRecord(res.data?.data);
      }
      const mapped = mapTicket(raw ?? {});
      if (!mapped) {
        throw new PartnerApiError('Ticket was created but the response was empty.');
      }
      return mapped;
    } catch (error) {
      throwSupportError(error, 'Failed to create ticket');
    }
  },

  addMessage: async (
    ticketId: string,
    payload: AddSupportTicketMessagePayload
  ): Promise<SupportTicketDetail> => {
    const text = payload.text?.trim() ?? '';
    if (!text && !payload.screenshotUri) {
      throw new PartnerApiError(
        'Enter a message or attach a screenshot.',
        'INVALID_TICKET_MESSAGE'
      );
    }
    assertApiBaseUrl();
    try {
      let raw: Record<string, unknown> | null = null;
      if (payload.screenshotUri) {
        raw = await postMultipartWithFields(`${ME}/tickets/${ticketId}/messages`, {
          fields: text ? { text } : {},
          files: [attachmentFile(payload.screenshotUri, 'support-reply.jpg')],
        });
      } else {
        const res = await api.post<Envelope<unknown>>(
          `${ME}/tickets/${ticketId}/messages`,
          { text }
        );
        raw = asRecord(res.data?.data);
      }
      const mapped = mapDetail(raw ?? {});
      if (!mapped) {
        throw new PartnerApiError('Message sent but the response was empty.');
      }
      return mapped;
    } catch (error) {
      throwSupportError(error, 'Failed to send message');
    }
  },

  closeTicket: async (ticketId: string): Promise<SupportTicketDetail> => {
    assertApiBaseUrl();
    try {
      const res = await api.put<Envelope<unknown>>(
        `${ME}/tickets/${ticketId}/close`
      );
      const mapped = mapDetail(asRecord(res.data?.data) ?? {});
      if (!mapped) throw new PartnerApiError('Could not close ticket.');
      return mapped;
    } catch (error) {
      throwSupportError(error, 'Failed to close ticket');
    }
  },

  reopenTicket: async (
    ticketId: string,
    reason: string
  ): Promise<SupportTicketDetail> => {
    assertApiBaseUrl();
    try {
      const res = await api.put<Envelope<unknown>>(
        `${ME}/tickets/${ticketId}/reopen`,
        { reason }
      );
      const mapped = mapDetail(asRecord(res.data?.data) ?? {});
      if (!mapped) throw new PartnerApiError('Could not reopen ticket.');
      return mapped;
    } catch (error) {
      throwSupportError(error, 'Failed to reopen ticket');
    }
  },

  requestCallback: async (input?: {
    reasonCode?: string;
    preferredWindow?: string;
    note?: string;
    ticketId?: string;
  }): Promise<void> => {
    assertApiBaseUrl();
    try {
      await api.post(`${ME}/call-request`, {
        reasonCode: input?.reasonCode ?? 'other',
        preferredWindow: input?.preferredWindow ?? 'asap',
        ...(input?.note ? { note: input.note } : {}),
        ...(input?.ticketId ? { ticketId: input.ticketId } : {}),
      });
    } catch (error) {
      throwSupportError(error, 'Failed to request callback');
    }
  },
};
