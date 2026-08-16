import { create } from 'zustand';

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed';

export type Order = {
  id: string;
  customerName: string;
  items: { name: string; quantity: number }[];
  total: number;
  status: OrderStatus;
  createdAt: string;
};

type OrdersState = {
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  updateOrderStatus: (id: string, status: OrderStatus) => void;
  pendingCount: () => number;
};

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  setOrders: (orders) => set({ orders }),
  updateOrderStatus: (id, status) =>
    set((state) => ({
      orders: state.orders.map((order) =>
        order.id === id ? { ...order, status } : order
      ),
    })),
  pendingCount: () =>
    get().orders.filter((o) => o.status === 'pending').length,
}));
