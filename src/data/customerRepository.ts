import type {
  MenuCategory,
  MenuItem,
  OrderItemInput,
  OrderStatus,
  TicketLine,
  TicketStatus,
} from '../domain';

/** What a customer may see of their own order. */
export interface CustomerOrder {
  id: string;
  tableId: string;
  tableName: string;
  status: OrderStatus;
  lines: TicketLine[];
  total: number;
  createdAt: string;
  expiresAt: string;
  paidAt?: string | null;
  /** How far the kitchen has got. Missing until the order is paid. */
  ticketStatus?: TicketStatus | null;
  /** Lines staff cancelled after payment. The customer is owed a refund for these. */
  voidedLineIds: string[];
  /** Takeout only, once paid. */
  pickupNumber?: number | null;
}

/**
 * Customer access, for people who have not signed in. Deliberately separate from
 * Repository so that customer code has no way to reach staff operations.
 */
export interface CustomerRepository {
  /** Resolves to null when no table has this token. */
  getTable(tableToken: string): Promise<{ name: string; takeout: boolean } | null>;
  getMenu(): Promise<{ categories: MenuCategory[]; items: MenuItem[] }>;
  /**
   * Safe to retry with the same order id. The server sets the prices, and rejects
   * with OrderRejectedError when they differ from expectedTotal.
   */
  placeOrder(input: {
    orderId: string;
    tableToken: string;
    items: OrderItemInput[];
    expectedTotal: number;
  }): Promise<CustomerOrder>;
  /** Resolves to null when there is no such order. */
  getOrder(orderId: string): Promise<CustomerOrder | null>;
}
