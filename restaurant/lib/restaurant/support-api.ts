import axios from 'axios';

import { api } from '@/lib/api';
import type {
  CreateKitchenTicketInput,
  KitchenSupportTicket,
  KitchenTicketPage,
  KitchenTicketStatus,
} from '@/lib/restaurant/support-types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    hasNext?: boolean;
  };
  code?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function throwSupportError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      throw new Error(
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
      throw new Error(
        'Security token expired. Close and reopen the app, then try again.'
      );
    }
    if (code === 'INVALID_TICKET_CATEGORY') {
      throw Object.assign(new Error(`Pick a valid help topic. (${code})`), {
        status: 422,
        code,
      });
    }
    const suffix = code ? ` (${code})` : ` (${error.response.status})`;
    const err = new Error(`${message}${suffix}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = error.response.status;
    err.code = code;
    throw err;
  }
  if (error instanceof Error) throw error;
  throw new Error(fallback);
}

function mapTicket(raw: Record<string, unknown>): KitchenSupportTicket | null {
  const ticketId = String(raw.ticketId ?? raw._id ?? raw.id ?? '').trim();
  if (!ticketId) return null;
  return {
    ticketId,
    ticketNo: String(raw.ticketNo ?? ''),
    restaurantId: String(raw.restaurantId ?? ''),
    category: String(raw.category ?? 'other'),
    subject: String(raw.subject ?? ''),
    description: String(raw.description ?? ''),
    status: String(raw.status ?? 'open'),
    priority: String(raw.priority ?? 'medium'),
    orderId: raw.orderId ? String(raw.orderId) : null,
    payoutId: raw.payoutId ? String(raw.payoutId) : null,
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

export const kitchenSupportApi = {
  listTickets: async (
    restaurantId: string,
    params?: { page?: number; limit?: number; status?: KitchenTicketStatus }
  ): Promise<KitchenTicketPage> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/support/tickets`,
        {
          params: {
            page: params?.page ?? 1,
            limit: params?.limit ?? 20,
            ...(params?.status ? { status: params.status } : {}),
          },
        }
      );
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      const meta = res.data?.meta ?? {};
      const page = Number(meta.page) || params?.page || 1;
      const limit = Number(meta.limit) || params?.limit || 20;
      const total = Number(meta.total) || rows.length;
      const totalPages = Number(meta.totalPages) || Math.max(1, Math.ceil(total / limit));
      return {
        tickets: rows
          .map((row) => mapTicket(asRecord(row) ?? {}))
          .filter(Boolean) as KitchenSupportTicket[],
        total,
        page,
        limit,
        totalPages,
        hasNext: Boolean(meta.hasNext) || page < totalPages,
      };
    } catch (error) {
      throwSupportError(error, 'Failed to load help tickets');
    }
  },

  createTicket: async (
    restaurantId: string,
    input: CreateKitchenTicketInput
  ): Promise<KitchenSupportTicket> => {
    const subject = input.subject.trim();
    const description = input.description.trim();
    if (subject.length < 5) {
      throw new Error('Subject must be at least 5 characters.');
    }
    if (description.length < 10) {
      throw new Error('Describe the issue in at least 10 characters.');
    }
    try {
      const res = await api.post<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/support/tickets`,
        {
          category: input.category,
          subject,
          description,
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.orderId ? { orderId: input.orderId } : {}),
          ...(input.payoutId ? { payoutId: input.payoutId } : {}),
        }
      );
      const mapped = mapTicket(asRecord(res.data?.data) ?? {});
      if (!mapped) throw new Error('Ticket was created but the response was empty.');
      return mapped;
    } catch (error) {
      throwSupportError(error, 'Failed to create ticket');
    }
  },
};
