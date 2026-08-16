export type KitchenTicketCategory =
  | 'orders'
  | 'payout'
  | 'menu'
  | 'kyc'
  | 'app'
  | 'other';

export type KitchenTicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_on_restaurant'
  | 'resolved'
  | 'closed';

export type KitchenTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type KitchenSupportTicket = {
  ticketId: string;
  ticketNo: string;
  restaurantId: string;
  category: KitchenTicketCategory | string;
  subject: string;
  description: string;
  status: KitchenTicketStatus | string;
  priority: KitchenTicketPriority | string;
  orderId: string | null;
  payoutId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateKitchenTicketInput = {
  category: KitchenTicketCategory;
  subject: string;
  description: string;
  priority?: KitchenTicketPriority;
  orderId?: string;
  payoutId?: string;
};

export type KitchenTicketPage = {
  tickets: KitchenSupportTicket[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
};
