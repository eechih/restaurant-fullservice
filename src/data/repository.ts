import type {
  Catalog,
  CatalogChange,
  DailyRecords,
  DiscountRequest,
  InvoiceRequest,
  LiveChange,
  LiveState,
  OrderItemInput,
  PaymentMethod,
  PaymentRequest,
  Role,
  StaffMember,
  TicketStatus,
} from '../domain';

export interface LiveHandlers {
  onChange(change: LiveChange): void;
  onConnection(online: boolean): void;
}

/** Managers' control of staff accounts. Rejects with StaffRejectedError when a change is refused. */
export interface StaffDirectory {
  list(): Promise<StaffMember[]>;
  /** Emails a temporary password. */
  invite(email: string, roles: Role[]): Promise<void>;
  /** Sends a new temporary password to someone who has not signed in yet. */
  resendInvite(email: string): Promise<void>;
  /** Removing a role also signs them out of other devices. */
  setRoles(username: string, roles: Role[]): Promise<void>;
  /** Disabling also signs them out of other devices. */
  setEnabled(username: string, enabled: boolean): Promise<void>;
}

/**
 * Writes to the floor, the kitchen and the bill. Each resolves to what it changed,
 * and rejects with RejectedError when it breaks a rule. Each is safe to retry
 * with the same ids.
 */
export interface LiveOperations {
  openTable(input: { checkId: string; tableId: string; guestCount: number; waitlistEntryId?: string }): Promise<LiveChange>;
  /** For a party that leaves before ordering. */
  cancelTable(checkId: string): Promise<LiveChange>;
  /** Moves the party from one of its tables to an empty one. */
  moveTable(checkId: string, fromTableId: string, toTableId: string): Promise<LiveChange>;
  /** Seats the party at another empty table as well, on the same bill. */
  addTable(checkId: string, tableId: string): Promise<LiveChange>;
  /** Moves one party's bill onto another's. Neither may have paid anything. */
  mergeChecks(fromCheckId: string, intoCheckId: string): Promise<LiveChange>;
  /** Prices the order on the server, which rejects it when the total differs from expectedTotal. */
  sendOrder(input: { orderId: string; checkId: string; items: OrderItemInput[]; expectedTotal: number }): Promise<LiveChange>;
  confirmCustomerOrder(orderId: string): Promise<LiveChange>;
  rejectCustomerOrder(orderId: string): Promise<LiveChange>;
  setTicketStatus(ticketId: string, status: TicketStatus): Promise<LiveChange>;
  serveTickets(ticketIds: string[]): Promise<LiveChange>;
  /** Approved at once when the caller may approve cancellations. */
  requestVoid(input: { ticketId: string; lineId: string; reason: string }): Promise<LiveChange>;
  decideVoid(voidId: string, approve: boolean): Promise<LiveChange>;
  /** Approved at once when the caller may approve discounts. */
  requestDiscount(checkId: string, request: DiscountRequest): Promise<LiveChange>;
  decideDiscount(checkId: string, discountId: string, approve: boolean): Promise<LiveChange>;
  removeDiscount(checkId: string, discountId: string): Promise<LiveChange>;
  requestBill(checkId: string): Promise<LiveChange>;
  /** The server works out the amount, and rejects it when it differs from expectedAmount. */
  recordPayment(
    input: {
      paymentId: string;
      checkId: string;
      method: PaymentMethod;
      expectedAmount: number;
      invoice?: InvoiceRequest;
    } & PaymentRequest,
  ): Promise<LiveChange>;
  closeCheck(checkId: string): Promise<LiveChange>;
  markTableCleaned(tableId: string): Promise<LiveChange>;
  /** A booking has reservedFor. */
  addToWaitlist(input: {
    id: string;
    name: string;
    partySize: number;
    phone?: string | null;
    reservedFor?: string | null;
    note?: string | null;
  }): Promise<LiveChange>;
  /** noShow marks a booking that never came. */
  cancelWaitlistEntry(id: string, noShow?: boolean): Promise<LiveChange>;
}

/** Staff access. Implemented by AWS Amplify, and by browser storage for local demo mode. */
export interface Repository extends LiveOperations {
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
  /** Managers and supervisors. */
  getDailyRecords(date: string): Promise<DailyRecords>;
  /** Missing in demo mode, which has no accounts. */
  readonly staff?: StaffDirectory;
  resetDemo?(): void;
}
