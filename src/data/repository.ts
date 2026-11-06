import type {
  Catalog,
  CatalogChange,
  GuestCheck,
  LineVoid,
  LiveEvent,
  Order,
  LiveState,
  OrderItemInput,
  PaymentMethod,
  StaffMember,
  StaffRole,
  TicketStatus,
} from '../domain';

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onConnection(online: boolean): void;
}

/** Managers' control of staff accounts. Rejects with UserFacingError when a change is refused. */
export interface StaffDirectory {
  list(): Promise<StaffMember[]>;
  /** Emails a temporary password. */
  invite(email: string, role: StaffRole): Promise<void>;
  /** Sends a new temporary password to someone who has not signed in yet. */
  resendInvite(email: string): Promise<void>;
  setRole(username: string, role: StaffRole): Promise<void>;
  /** Disabling also signs them out of other devices. */
  setEnabled(username: string, enabled: boolean): Promise<void>;
}

/** Staff access. Implemented by AWS Amplify, and by browser storage for local demo mode. */
export interface Repository {
  readonly mode: 'amplify' | 'demo';
  getCatalog(): Promise<Catalog>;
  seedCatalog(): Promise<void>;
  /** Managers only. */
  changeCatalog(changes: CatalogChange[]): Promise<void>;
  setItemAvailable(itemId: string, available: boolean): Promise<void>;
  /** Issues a new QR token for the table, which stops its old QR code working. */
  rotateTableToken(tableId: string): Promise<void>;
  loadLiveState(): Promise<LiveState>;
  subscribe(handlers: LiveHandlers): () => void;
  /** Rejects with ConflictError when the table is already occupied. */
  openTable(input: { tableId: string; tableName: string; guestCount: number }): Promise<GuestCheck>;
  /**
   * Safe to retry with the same order id. The server sets the prices, and rejects
   * with OrderRejectedError when they differ from expectedTotal.
   */
  placeStaffOrder(input: {
    orderId: string;
    tableId: string;
    items: OrderItemInput[];
    expectedTotal: number;
  }): Promise<void>;
  /**
   * Marks the order paid and sends it to the kitchen as one atomic step, opening
   * the table if needed. Safe to retry. Resolves to the resulting changes.
   */
  confirmOrderPayment(orderId: string, paymentMethod: PaymentMethod): Promise<LiveEvent[]>;
  setTicketStatus(ticketId: string, status: TicketStatus): Promise<void>;
  /** Safe to retry; voiding a voided line changes nothing. */
  voidLine(lineVoid: LineVoid): Promise<void>;
  clearTable(tableId: string): Promise<void>;
  /**
   * Managers only. Orders paid on a business date, and the cancellations of
   * their lines whenever those happened.
   */
  getDailyRecords(date: string): Promise<{ orders: Order[]; voids: LineVoid[] }>;
  /** Missing in demo mode, which has no accounts. */
  readonly staff?: StaffDirectory;
  resetDemo?(): void;
}
