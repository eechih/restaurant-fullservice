import type { MenuCategory, MenuItem, OrderItemInput, OrderStatus, TicketLine, TicketStatus } from '../domain';

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
  /** How far the slowest station has got. Missing until a server sends it. */
  kitchenStatus?: TicketStatus | null;
  /** Lines staff cancelled. They are not on the bill. */
  voidedLineIds: string[];
}

/**
 * Customer access, for people who have not signed in. Deliberately separate from
 * Repository so that customer code has no way to reach staff operations.
 */
export interface CustomerRepository {
  /** Resolves to null when no table has this token. */
  getTable(tableToken: string): Promise<{ name: string } | null>;
  getMenu(): Promise<{ categories: MenuCategory[]; items: MenuItem[] }>;
  /**
   * Safe to retry with the same order id. The server sets the prices, and rejects
   * with RejectedError when they differ from expectedTotal.
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
