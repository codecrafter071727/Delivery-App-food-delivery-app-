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

export type KitchenTicketStage = 'initiated' | 'working' | 'closed';

export type KitchenTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type KitchenTicketRemark = {
  id: string;
  text: string;
  authorRole: 'restaurant' | 'agent' | 'system';
  authorName: string | null;
  createdAt: string;
};

export type KitchenSupportTicket = {
  ticketId: string;
  ticketNo: string;
  restaurantId: string;
  category: KitchenTicketCategory | string;
  subject: string;
  description: string;
  status: KitchenTicketStatus | string;
  stage: KitchenTicketStage;
  priority: KitchenTicketPriority | string;
  orderId: string | null;
  payoutId: string | null;
  remarks: KitchenTicketRemark[];
  latestRemark: string | null;
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

export const TICKET_STAGE_STEPS: { id: KitchenTicketStage; label: string }[] = [
  { id: 'initiated', label: 'Initiated' },
  { id: 'working', label: 'Working on it' },
  { id: 'closed', label: 'Closed' },
];
