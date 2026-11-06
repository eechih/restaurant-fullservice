// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Cognito groups. An account may belong to several. */
export const ROLES = ['MANAGER', 'SUPERVISOR', 'CASHIER', 'SERVER', 'KITCHEN'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  MANAGER: '店長',
  SUPERVISOR: '主管',
  CASHIER: '櫃台',
  SERVER: '服務員',
  KITCHEN: '廚房',
};
export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export type Permission =
  /** Menu, stations, tables, QR codes and staff accounts. */
  | 'settings'
  | 'report'
  /** Approve cancellations and discounts. */
  | 'approve'
  /** Ask for a discount. */
  | 'discount'
  | 'waitlist'
  | 'openTable'
  /** Order, confirm customers' QR orders, ask to cancel a line, ask for the bill. */
  | 'order'
  | 'serve'
  | 'checkout'
  | 'clearTable'
  /** Change a kitchen ticket's progress. */
  | 'cook'
  | 'availability';

const PERMISSION_ROLES: Record<Permission, readonly Role[]> = {
  settings: ['MANAGER'],
  report: ['MANAGER', 'SUPERVISOR'],
  approve: ['MANAGER', 'SUPERVISOR'],
  discount: ['MANAGER', 'SUPERVISOR', 'CASHIER', 'SERVER'],
  waitlist: ['MANAGER', 'SUPERVISOR', 'CASHIER'],
  openTable: ['MANAGER', 'SUPERVISOR', 'CASHIER', 'SERVER'],
  order: ['MANAGER', 'SUPERVISOR', 'SERVER'],
  serve: ['MANAGER', 'SUPERVISOR', 'SERVER', 'KITCHEN'],
  checkout: ['MANAGER', 'SUPERVISOR', 'CASHIER'],
  clearTable: ['MANAGER', 'SUPERVISOR', 'CASHIER', 'SERVER'],
  cook: ['MANAGER', 'SUPERVISOR', 'KITCHEN'],
  availability: ['MANAGER', 'SUPERVISOR', 'KITCHEN'],
};

/** The groups allowed to do something. The backend's authorization rules use this too. */
export const rolesFor = (permission: Permission): Role[] => [...PERMISSION_ROLES[permission]];

export const can = (roles: readonly Role[], permission: Permission) =>
  roles.some((role) => PERMISSION_ROLES[permission].includes(role));

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED';
export type PaymentMethod = 'CASH' | 'CARD';
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: '現金', CARD: '刷卡' };

export interface OptionChoice {
  id: string;
  name: string;
  priceDelta: number;
}
export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: OptionChoice[];
}
/** A kitchen section that cooks its own share of each order, such as the wok or the bar. */
export interface Station {
  id: string;
  name: string;
  sortOrder: number;
}
export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  sortOrder: number;
  optionGroups: OptionGroup[];
  /** False when sold out. Missing means available. */
  available?: boolean | null;
  /** Overrides the category's station. */
  stationId?: string | null;
  /** Left out of the service charge, for example bottled drinks to take away. */
  noServiceCharge?: boolean | null;
}
export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** Where the category's items are cooked unless an item says otherwise. */
  stationId?: string | null;
}
export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  sortOrder: number;
  /** A floor or area, such as 一樓 or 包廂. */
  zone?: string | null;
  /** What the table's QR code carries. Customers must never be able to read it. */
  qrToken?: string | null;
}
/** What the restaurant prints on receipts, and its service charge. */
export interface StoreSettings {
  storeName: string;
  /** 統一編號. */
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  /** Percent of the bill after discounts. A check keeps the rate it was opened with. */
  serviceChargeRate: number;
}
export const defaultSettings: StoreSettings = { storeName: '', serviceChargeRate: 0 };
export const MAX_SERVICE_CHARGE_RATE = 30;

export interface Catalog {
  tables: DiningTable[];
  categories: MenuCategory[];
  items: MenuItem[];
  stations: Station[];
  settings: StoreSettings;
}

/** The station an item is cooked at, or null when none is set or it was deleted. */
export function stationFor(
  catalog: Pick<Catalog, 'items' | 'categories' | 'stations'>,
  menuItemId: string,
): string | null {
  const item = catalog.items.find((candidate) => candidate.id === menuItemId);
  const category = catalog.categories.find((candidate) => candidate.id === item?.categoryId);
  const id = item?.stationId || category?.stationId;
  return id && catalog.stations.some((station) => station.id === id) ? id : null;
}

export const stationName = (catalog: Pick<Catalog, 'stations'>, stationId: string | null | undefined) =>
  catalog.stations.find((station) => station.id === stationId)?.name ?? '未指定出餐站';

/** Zones in the order their first table appears. Tables without one are left out. */
export const zonesOf = (tables: DiningTable[]) => [
  ...new Set(tables.flatMap((table) => (table.zone ? [table.zone] : []))),
];

// ---------------------------------------------------------------------------
// Live records
// ---------------------------------------------------------------------------

export interface SelectedOption {
  groupName: string;
  choiceName: string;
  priceDelta: number;
}
export interface TicketLine {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  /** Base price plus option deltas, frozen when the line is created. */
  unitPrice: number;
  options: SelectedOption[];
  note?: string | null;
  /** Set when the order is sent to the kitchen. */
  stationId?: string | null;
  /** Set when the order is sent, from the menu item. */
  noServiceCharge?: boolean | null;
}
export interface Seating {
  tableId: string;
  checkId: string;
}

/**
 * OPEN while the party is eating. CLOSED once paid in full, when the table waits
 * to be cleaned. CANCELLED when the table was opened and nothing was ordered.
 */
export type CheckStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

/**
 * One party's stay at a table, and their bill. The totals are kept on the check
 * so that the server can check a payment against them in one consistent read.
 */
export interface GuestCheck {
  id: string;
  tableId: string;
  tableName: string;
  guestCount?: number | null;
  /** The name they gave on the waitlist. */
  partyName?: string | null;
  status: CheckStatus;
  openedAt: string;
  /** How many rounds have been sent. */
  rounds: number;
  /** Every ticket sent, so that the server can read the whole bill consistently. */
  ticketIds: string[];
  discounts: Discount[];
  /** Taken from the settings when the table was opened. */
  serviceChargeRate: number;
  /** What was ordered, less approved cancellations. */
  itemsTotal: number;
  /** Approved discounts. */
  discountTotal: number;
  serviceCharge: number;
  /** What the party owes: items, less discounts, plus the service charge. */
  billTotal: number;
  paidTotal: number;
  /** Lines someone paid for by splitting the bill by item. */
  paidLineKeys: string[];
  /** Set when a server asks the cashier to bring the bill. */
  billRequestedAt?: string | null;
  closedAt?: string | null;
  /** The business date it was paid on, for the daily report. */
  closedDate?: string | null;
  updatedAt: string;
}

export type OrderSource = 'STAFF' | 'CUSTOMER';
/** EXPIRED is derived from expiresAt; it is never stored. */
export type OrderStatus = 'PENDING' | 'SENT' | 'REJECTED' | 'EXPIRED';

/**
 * One round of ordering. Staff orders are sent at once. A customer's QR order
 * waits as PENDING until a server confirms it.
 */
export interface Order {
  id: string;
  source: OrderSource;
  tableId: string;
  tableName: string;
  /** Set when sent. */
  checkId?: string | null;
  status: OrderStatus;
  lines: TicketLine[];
  total: number;
  createdAt: string;
  expiresAt: string;
  round?: number | null;
  ticketIds: string[];
  decidedAt?: string | null;
  updatedAt: string;
}

/** One station's share of a round. */
export interface KitchenTicket {
  id: string;
  orderId: string;
  checkId: string;
  tableName: string;
  round: number;
  stationId?: string | null;
  status: TicketStatus;
  sentAt: string;
  /** When it last entered each status, for the kitchen report. */
  startedAt?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  lines: TicketLine[];
  updatedAt: string;
}

export type VoidStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';
/**
 * A request to cancel a line, keyed by lineKey so that a line has at most one.
 * Only an approved one takes the line off the bill.
 */
export interface LineVoid {
  id: string;
  ticketId: string;
  checkId: string;
  lineId: string;
  reason: string;
  status: VoidStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  updatedAt: string;
}

/**
 * LINE_COMP makes a line free. The percents are taken off, so 10 means 9 折.
 * A discount needs a supervisor, like a cancellation, unless one asks for it.
 */
export type DiscountKind = 'CHECK_PERCENT' | 'CHECK_AMOUNT' | 'LINE_COMP' | 'LINE_PERCENT' | 'LINE_AMOUNT';
export interface Discount {
  id: string;
  kind: DiscountKind;
  /** Percent off, or dollars off. Zero for a comp. */
  value: number;
  /** For the LINE kinds. */
  lineKey?: string | null;
  reason: string;
  status: VoidStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
}
export const isLineDiscount = (kind: DiscountKind) => kind.startsWith('LINE_');

export type CarrierType = 'NONE' | 'MOBILE' | 'CERTIFICATE';
/** What the payer wants on their e-invoice. Issuing it is left until a provider is chosen. */
export interface InvoiceRequest {
  carrierType: CarrierType;
  /** The mobile barcode or citizen certificate number. */
  carrierId?: string | null;
  /** 統一編號, for a company. */
  buyerTaxId?: string | null;
  /** 愛心碼, to donate the invoice. */
  donationCode?: string | null;
}
export const noInvoiceDetails: InvoiceRequest = { carrierType: 'NONE' };

/** How a payment's amount is worked out. The server works it out again. */
export type PaymentKind = 'BALANCE' | 'AMOUNT' | 'SHARE' | 'LINES';
export interface Payment {
  id: string;
  checkId: string;
  tableName: string;
  method: PaymentMethod;
  kind: PaymentKind;
  amount: number;
  /** SHARE only: how many equal shares the balance was split into. */
  parts?: number | null;
  /** LINES only. */
  lineKeys: string[];
  paidAt: string;
  businessDate: string;
  invoice: InvoiceRequest;
  /** Set once e-invoices are issued. Until then the invoice is still to be issued. */
  invoiceNumber?: string | null;
}

export type WaitlistStatus = 'WAITING' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';
/** A party waiting for a table, or one that booked ahead, which has reservedFor. */
export interface WaitlistEntry {
  id: string;
  name: string;
  partySize: number;
  phone?: string | null;
  reservedFor?: string | null;
  note?: string | null;
  status: WaitlistStatus;
  createdAt: string;
  seatedAt?: string | null;
  tableId?: string | null;
  updatedAt: string;
}

/**
 * A timestamp after the record's last one. Writes are checked against the last
 * one, and screens keep whichever copy is newer, so it must always move forward.
 */
export function stampAfter(...previous: (string | null | undefined)[]) {
  const after = Math.max(0, ...previous.map((value) => (value ? Date.parse(value) + 1 : 0)));
  return new Date(Math.max(Date.now(), after)).toISOString();
}

/** Fixed per order and station, so that sending an order twice cannot create two tickets. */
export const ticketIdFor = (orderId: string, stationId: string | null | undefined) =>
  `${orderId}:${stationId ?? 'none'}`;

/** Names a line on a bill. Also the id of the line's cancellation. */
export const lineKey = (ticketId: string, lineId: string) => `${ticketId}#${lineId}`;
export const voidId = lineKey;
export function parseLineKey(key: string): { ticketId: string; lineId: string } | undefined {
  const index = key.lastIndexOf('#');
  return index > 0 && index < key.length - 1
    ? { ticketId: key.slice(0, index), lineId: key.slice(index + 1) }
    : undefined;
}

/** A short code customers can read out. Unique enough within a table. */
export const orderCode = (orderId: string) => orderId.slice(0, 4).toUpperCase();

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

/** Thrown when the server rejects a write because the record already exists. */
export class ConflictError extends Error {}

export const REJECTION_MESSAGE = {
  FORBIDDEN: '你的角色不能做這件事',
  TABLE_NOT_FOUND: '找不到這張桌子',
  ITEM_UNAVAILABLE: '有品項已售完或已下架，請重新點餐',
  INVALID_ITEMS: '點餐內容有誤，請重新點餐',
  PRICE_CHANGED: '菜單價格已變更，請重新點餐',
  TOO_MANY_PENDING: '這桌待確認的訂單太多，請稍後再試或洽服務員',
  ORDER_NOT_FOUND: '找不到這筆訂單',
  ORDER_EXPIRED: '這筆訂單已逾時，請重新點餐',
  ORDER_DECIDED: '這筆訂單已經有人處理了',
  TABLE_OCCUPIED: '這桌已經有人了',
  TABLE_NOT_OPEN: '這桌目前沒有開桌，請先開桌',
  INVALID_GUESTS: '人數有誤',
  CHECK_CLOSED: '這張帳單已經結帳',
  CHECK_HAS_ORDERS: '這桌已經點過餐，不能取消開桌',
  CHECK_PAYING: '這張帳單已開始收款，不能再取消品項',
  LINE_NOT_FOUND: '找不到這個品項，請重新整理',
  VOID_EXISTS: '這個品項已經取消，或正在申請取消',
  VOID_DECIDED: '這筆取消申請已經有人處理了',
  INVALID_REASON: '請選擇取消原因',
  AMOUNT_CHANGED: '帳單金額剛有變動，請確認金額後再收款',
  INVALID_PAYMENT: '付款金額有誤',
  LINE_ALREADY_PAID: '有品項已經有人付過了，請重新選擇',
  NOTHING_TO_PAY: '這張帳單沒有待付金額',
  BALANCE_DUE: '還有未付金額，不能結束帳單',
  TABLE_NOT_CLEARABLE: '這桌還沒結帳，不能清桌',
  TICKET_NOT_FOUND: '找不到這張工作單，請重新整理',
  WAITLIST_INVALID: '資料有誤，請確認稱呼、人數、電話和時間',
  INVALID_DISCOUNT: '折扣內容有誤',
  DISCOUNT_EXISTS: '這個品項或這張帳單已經有折扣，或正在申請',
  DISCOUNT_NOT_FOUND: '找不到這筆折扣，請重新整理',
  INVALID_INVOICE: '發票資料有誤，請確認載具、統編或愛心碼',
  WAITLIST_DECIDED: '這組客人已經帶位或取消',
  CONFLICT: '其他人剛修改了這筆資料，請再試一次',
} as const;
export type Rejection = keyof typeof REJECTION_MESSAGE;
export const isRejection = (value: string): value is Rejection => Object.hasOwn(REJECTION_MESSAGE, value);

/** Thrown when a request breaks a business rule. Its message is the code. */
export class RejectedError extends Error {
  constructor(readonly code: Rejection) {
    super(code);
  }
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export interface LiveState {
  seatings: Record<string, Seating>;
  checks: Record<string, GuestCheck>;
  tickets: Record<string, KitchenTicket>;
  voids: Record<string, LineVoid>;
  /** Customers' orders that are, or were while this screen was open, waiting to be confirmed. */
  orders: Record<string, Order>;
  payments: Record<string, Payment>;
  waitlist: Record<string, WaitlistEntry>;
}
export const emptyLiveState: LiveState = {
  seatings: {},
  checks: {},
  tickets: {},
  voids: {},
  orders: {},
  payments: {},
  waitlist: {},
};

/** What a write changed. The server sends it to every staff screen. */
export interface LiveChange {
  seatings?: Seating[];
  /** Seatings removed. A removal only applies while the table is still on that check. */
  clearedSeatings?: Seating[];
  checks?: GuestCheck[];
  tickets?: KitchenTicket[];
  voids?: LineVoid[];
  orders?: Order[];
  payments?: Payment[];
  waitlist?: WaitlistEntry[];
}

/**
 * Adds records, keeping the newer copy, because a write's own result and the
 * notification of someone else's later write can arrive in either order.
 */
function upsert<T extends object>(
  records: Record<string, T>,
  incoming: T[] | undefined,
  keyOf: (record: T) => string,
): Record<string, T> {
  if (!incoming?.length) return records;
  const next = { ...records };
  for (const record of incoming) {
    const key = keyOf(record);
    const current = next[key] as { updatedAt?: string } | undefined;
    const incomingAt = (record as { updatedAt?: string }).updatedAt;
    if (current?.updatedAt && incomingAt && current.updatedAt > incomingAt) continue;
    next[key] = record;
  }
  return next;
}

export function applyChange(state: LiveState, change: LiveChange): LiveState {
  let seatings = upsert(state.seatings, change.seatings, (seating) => seating.tableId);
  if (change.clearedSeatings?.length) {
    seatings = { ...seatings };
    for (const cleared of change.clearedSeatings) {
      if (seatings[cleared.tableId]?.checkId === cleared.checkId) delete seatings[cleared.tableId];
    }
  }
  return {
    seatings,
    checks: upsert(state.checks, change.checks, (check) => check.id),
    tickets: upsert(state.tickets, change.tickets, (ticket) => ticket.id),
    voids: upsert(state.voids, change.voids, (lineVoid) => lineVoid.id),
    orders: upsert(state.orders, change.orders, (order) => order.id),
    payments: upsert(state.payments, change.payments, (payment) => payment.id),
    waitlist: upsert(state.waitlist, change.waitlist, (entry) => entry.id),
  };
}

export const lineAmount = (line: Pick<TicketLine, 'unitPrice' | 'quantity'>) => line.unitPrice * line.quantity;

export const isLineVoided = (state: Pick<LiveState, 'voids'>, ticketId: string, lineId: string) =>
  state.voids[voidId(ticketId, lineId)]?.status === 'APPROVED';

/** True when nothing on the ticket is left to cook or bill. */
export const isFullyVoided = (state: Pick<LiveState, 'voids'>, ticket: KitchenTicket) =>
  ticket.lines.every((line) => isLineVoided(state, ticket.id, line.id));

export const ticketsForCheck = (state: LiveState, checkId: string): KitchenTicket[] =>
  Object.values(state.tickets)
    .filter((ticket) => ticket.checkId === checkId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));

export const paymentsForCheck = (state: LiveState, checkId: string): Payment[] =>
  Object.values(state.payments)
    .filter((payment) => payment.checkId === checkId)
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt));

export const balanceOf = (check: Pick<GuestCheck, 'billTotal' | 'paidTotal'>) =>
  check.billTotal - check.paidTotal;

export const openCheckFor = (state: LiveState, tableId: string): GuestCheck | undefined => {
  const check = state.checks[state.seatings[tableId]?.checkId];
  return check?.status === 'OPEN' ? check : undefined;
};

export type TableState = 'EMPTY' | 'DINING' | 'CLEANING';

/** A table stays seated after it is paid, until someone marks it cleaned. */
export function tableState(state: LiveState, tableId: string): TableState {
  const seating = state.seatings[tableId];
  if (!seating) return 'EMPTY';
  const check = state.checks[seating.checkId];
  return check && check.status !== 'OPEN' ? 'CLEANING' : 'DINING';
}

/** A round, as the expo sees it: every station's ticket for one order. */
export interface Round {
  orderId: string;
  checkId: string;
  tableName: string;
  round: number;
  sentAt: string;
  tickets: KitchenTicket[];
}

export function roundsOf(tickets: KitchenTicket[]): Round[] {
  const byOrder = new Map<string, Round>();
  for (const ticket of tickets) {
    const round = byOrder.get(ticket.orderId) ?? {
      orderId: ticket.orderId,
      checkId: ticket.checkId,
      tableName: ticket.tableName,
      round: ticket.round,
      sentAt: ticket.sentAt,
      tickets: [],
    };
    round.tickets.push(ticket);
    byOrder.set(ticket.orderId, round);
  }
  return [...byOrder.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export const roundsForCheck = (state: LiveState, checkId: string) => roundsOf(ticketsForCheck(state, checkId));

const STATUS_ORDER: TicketStatus[] = ['NEW', 'PREPARING', 'READY', 'SERVED'];
export type RoundStatus = TicketStatus | 'VOIDED';

/** How far the slowest station has got. VOIDED when every line was cancelled. */
export function roundStatus(state: Pick<LiveState, 'voids'>, tickets: KitchenTicket[]): RoundStatus {
  const active = tickets.filter((ticket) => !isFullyVoided(state, ticket));
  if (active.length === 0) return 'VOIDED';
  return STATUS_ORDER[Math.min(...active.map((ticket) => STATUS_ORDER.indexOf(ticket.status)))];
}

/** Rounds the kitchen or the floor still has to deal with, oldest first. */
export const openRounds = (state: LiveState) =>
  roundsOf(Object.values(state.tickets)).filter((round) => {
    const status = roundStatus(state, round.tickets);
    return status !== 'SERVED' && status !== 'VOIDED';
  });

/** Rounds every station has finished, so they can go out together. */
export const readyRounds = (state: LiveState) =>
  openRounds(state).filter((round) => roundStatus(state, round.tickets) === 'READY');

/** Which station a kitchen screen shows: every one, those with none set, or one. */
export type StationFilter = 'ALL' | 'NONE' | string;

export function ticketsAtStation(state: LiveState, station: StationFilter, statuses: TicketStatus[]) {
  return Object.values(state.tickets)
    .filter(
      (ticket) =>
        statuses.includes(ticket.status) &&
        (station === 'ALL' || (ticket.stationId ?? 'NONE') === station),
    )
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export const effectiveOrderStatus = (
  order: Pick<Order, 'status' | 'expiresAt'>,
  now: number,
): OrderStatus =>
  order.status === 'PENDING' && new Date(order.expiresAt).getTime() <= now ? 'EXPIRED' : order.status;

/** Customers' orders waiting for a server to confirm them, oldest first. */
export const pendingOrders = (state: LiveState, now: number): Order[] =>
  Object.values(state.orders)
    .filter((order) => effectiveOrderStatus(order, now) === 'PENDING')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const voidRequests = (state: LiveState): LineVoid[] =>
  Object.values(state.voids)
    .filter((lineVoid) => lineVoid.status === 'REQUESTED')
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

export const billRequests = (state: LiveState): GuestCheck[] =>
  Object.values(state.checks)
    .filter((check) => check.status === 'OPEN' && check.billRequestedAt)
    .sort((a, b) => (a.billRequestedAt ?? '').localeCompare(b.billRequestedAt ?? ''));

/** Walk-ins, and bookings for today, still to be seated: bookings by their time, walk-ins as they came. */
export const waitingParties = (state: LiveState, now = Date.now()): WaitlistEntry[] =>
  Object.values(state.waitlist)
    .filter(
      (entry) =>
        entry.status === 'WAITING' && (!entry.reservedFor || businessDate(entry.reservedFor) === businessDate(now)),
    )
    .sort((a, b) => (a.reservedFor ?? a.createdAt).localeCompare(b.reservedFor ?? b.createdAt));

/** Bookings for a business date still to arrive, by time. */
export const reservationsOn = (state: LiveState, date: string): WaitlistEntry[] =>
  Object.values(state.waitlist)
    .filter((entry) => entry.status === 'WAITING' && entry.reservedFor && businessDate(entry.reservedFor) === date)
    .sort((a, b) => (a.reservedFor ?? '').localeCompare(b.reservedFor ?? ''));

/** Bookings due within the next while, so that a walk-in is not seated where someone booked. */
export const upcomingReservations = (state: LiveState, now: number, withinMs = 2 * 60 * 60_000) =>
  Object.values(state.waitlist).filter((entry) => {
    if (entry.status !== 'WAITING' || !entry.reservedFor) return false;
    const due = Date.parse(entry.reservedFor);
    return due >= now - 30 * 60_000 && due <= now + withinMs;
  });

/** Empty tables that seat the party, the closest fit first. */
export function suggestTables(catalog: Pick<Catalog, 'tables'>, state: LiveState, partySize: number) {
  return catalog.tables
    .filter((table) => tableState(state, table.id) === 'EMPTY' && table.seats >= partySize)
    .sort((a, b) => a.seats - b.seats || a.sortOrder - b.sortOrder);
}

export const discountRequests = (state: LiveState) =>
  Object.values(state.checks)
    .filter((check) => check.status === 'OPEN')
    .flatMap((check) =>
      check.discounts.filter((discount) => discount.status === 'REQUESTED').map((discount) => ({ check, discount })),
    )
    .sort((a, b) => a.discount.requestedAt.localeCompare(b.discount.requestedAt));

/** Sets a ticket's status, and notes when, for the kitchen report. */
export function withTicketStatus(ticket: KitchenTicket, status: TicketStatus, now: string): KitchenTicket {
  return {
    ...ticket,
    status,
    ...(status === 'PREPARING' ? { startedAt: now } : {}),
    ...(status === 'READY' ? { readyAt: now } : {}),
    ...(status === 'SERVED' ? { servedAt: now } : {}),
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// The bill
// ---------------------------------------------------------------------------

export interface BilledLine {
  key: string;
  ticket: KitchenTicket;
  line: TicketLine;
  /** Before any discount. */
  amount: number;
  /** After its own discount. */
  net: number;
  /** Its share of the bill after every discount and the service charge, for splitting by item. */
  payable: number;
  discount?: Discount;
}

export interface Bill {
  /** Lines still billed, in the order they were sent. */
  lines: BilledLine[];
  byKey: Record<string, BilledLine>;
  itemsTotal: number;
  lineDiscounts: number;
  checkDiscount: number;
  /** The part the service charge is taken on: chargeable lines, after discounts. */
  serviceBase: number;
  serviceCharge: number;
  total: number;
}

const percentOf = (amount: number, percent: number) => Math.round((amount * percent) / 100);

function discountedAmount(amount: number, discount: Discount | undefined) {
  switch (discount?.kind) {
    case 'LINE_COMP':
      return 0;
    case 'LINE_PERCENT':
      return amount - percentOf(amount, discount.value);
    case 'LINE_AMOUNT':
      return Math.max(0, amount - discount.value);
    default:
      return amount;
  }
}

/**
 * Works out a bill from what was sent, what was cancelled and the approved
 * discounts. Line discounts come first, then the bill's own discount, then the
 * service charge on what is left of the lines that carry one.
 */
export function billOf(
  check: Pick<GuestCheck, 'discounts' | 'serviceChargeRate'>,
  tickets: KitchenTicket[],
  voids: Record<string, LineVoid>,
): Bill {
  const approved = check.discounts.filter((discount) => discount.status === 'APPROVED');
  const lineDiscount = new Map(
    approved.filter((discount) => isLineDiscount(discount.kind)).map((discount) => [discount.lineKey, discount]),
  );
  const billDiscount = approved.find((discount) => !isLineDiscount(discount.kind));

  const billed = [...tickets]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id))
    .flatMap((ticket) =>
      ticket.lines
        .filter((line) => voids[voidId(ticket.id, line.id)]?.status !== 'APPROVED')
        .map((line) => {
          const key = lineKey(ticket.id, line.id);
          const discount = lineDiscount.get(key);
          const amount = lineAmount(line);
          return { key, ticket, line, amount, net: discountedAmount(amount, discount), discount };
        }),
    );
  const itemsTotal = billed.reduce((sum, line) => sum + line.amount, 0);
  const itemsNet = billed.reduce((sum, line) => sum + line.net, 0);
  const checkDiscount = !billDiscount
    ? 0
    : billDiscount.kind === 'CHECK_PERCENT'
      ? percentOf(itemsNet, billDiscount.value)
      : Math.min(billDiscount.value, itemsNet);
  // What is left of each dollar once the bill's own discount is spread over it.
  const remaining = itemsNet > 0 ? (itemsNet - checkDiscount) / itemsNet : 0;
  const rate = check.serviceChargeRate;
  const serviceBase = Math.round(
    billed.filter(({ line }) => !line.noServiceCharge).reduce((sum, line) => sum + line.net, 0) * remaining,
  );
  const serviceCharge = percentOf(serviceBase, rate);
  const lines = billed.map((line) => ({
    ...line,
    payable: Math.round(line.net * remaining * (line.line.noServiceCharge ? 1 : 1 + rate / 100)),
  }));
  return {
    lines,
    byKey: Object.fromEntries(lines.map((line) => [line.key, line])),
    itemsTotal,
    lineDiscounts: itemsTotal - itemsNet,
    checkDiscount,
    serviceBase,
    serviceCharge,
    total: itemsNet - checkDiscount + serviceCharge,
  };
}

/** The bill of a check on this screen. */
export const billFor = (state: LiveState, check: GuestCheck) =>
  billOf(check, ticketsForCheck(state, check.id), state.voids);

/** The check with its totals worked out again. Every change to what is billed goes through here. */
export const withBill = (check: GuestCheck, bill: Bill, now: string): GuestCheck => ({
  ...check,
  itemsTotal: bill.itemsTotal,
  discountTotal: bill.lineDiscounts + bill.checkDiscount,
  serviceCharge: bill.serviceCharge,
  billTotal: bill.total,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** Selected choice ids, keyed by option group id. */
export type OptionSelection = Record<string, string[]>;

export function missingRequiredGroups(item: MenuItem, selection: OptionSelection): OptionGroup[] {
  return item.optionGroups.filter((group) => group.required && !selection[group.id]?.length);
}

export function selectedOptions(item: MenuItem, selection: OptionSelection): SelectedOption[] {
  return item.optionGroups.flatMap((group) =>
    group.choices
      .filter((choice) => selection[group.id]?.includes(choice.id))
      .map((choice) => ({
        groupName: group.name,
        choiceName: choice.name,
        priceDelta: choice.priceDelta,
      })),
  );
}

export const unitPriceOf = (item: MenuItem, selection: OptionSelection) =>
  selectedOptions(item, selection).reduce((sum, option) => sum + option.priceDelta, item.price);

export function toggleChoice(
  selection: OptionSelection,
  group: OptionGroup,
  choiceId: string,
): OptionSelection {
  const current = selection[group.id] ?? [];
  const isSelected = current.includes(choiceId);
  let next: string[];
  if (group.multiple) {
    next = isSelected ? current.filter((id) => id !== choiceId) : [...current, choiceId];
  } else if (isSelected) {
    next = group.required ? current : [];
  } else {
    next = [choiceId];
  }
  return { ...selection, [group.id]: next };
}

export function buildLine(
  id: string,
  item: MenuItem,
  selection: OptionSelection,
  quantity: number,
  note: string,
): TicketLine {
  return {
    id,
    menuItemId: item.id,
    name: item.name,
    quantity,
    unitPrice: unitPriceOf(item, selection),
    options: selectedOptions(item, selection),
    note: note.trim() || null,
  };
}

export interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  choiceIds: string[];
  note?: string | null;
}

export const ORDER_LIFETIME_MS = 15 * 60_000;
/**
 * Anyone holding a table's QR link can order without signing in, so this keeps
 * one link from flooding the servers' list. Unconfirmed orders expire, so a
 * table that reaches it recovers by itself.
 */
export const MAX_PENDING_ORDERS_PER_TABLE = 10;
const MAX_ORDER_LINES = 50;
const MAX_LINE_QUANTITY = 99;
const MAX_NOTE_LENGTH = 200;

function selectionFromChoiceIds(item: MenuItem, choiceIds: string[]): OptionSelection {
  const selection: OptionSelection = {};
  for (const choiceId of new Set(choiceIds)) {
    const group = item.optionGroups.find((candidate) =>
      candidate.choices.some((choice) => choice.id === choiceId),
    );
    if (!group) throw new RejectedError('INVALID_ITEMS');
    selection[group.id] = [...(selection[group.id] ?? []), choiceId];
    if (!group.multiple && selection[group.id].length > 1) {
      throw new RejectedError('INVALID_ITEMS');
    }
  }
  return selection;
}

/**
 * Turns what was asked for into priced lines. The input may come from an
 * untrusted device, so it is checked here and carries no prices of its own.
 */
export function priceOrder(
  menu: MenuItem[],
  inputs: OrderItemInput[],
  newLineId: () => string,
): { lines: TicketLine[]; total: number } {
  if (inputs.length === 0 || inputs.length > MAX_ORDER_LINES) {
    throw new RejectedError('INVALID_ITEMS');
  }
  const lines = inputs.map(({ menuItemId, quantity, choiceIds, note }) => {
    const item = menu.find((candidate) => candidate.id === menuItemId);
    if (!item || item.available === false) throw new RejectedError('ITEM_UNAVAILABLE');
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY ||
      (note?.length ?? 0) > MAX_NOTE_LENGTH
    ) {
      throw new RejectedError('INVALID_ITEMS');
    }
    const selection = selectionFromChoiceIds(item, choiceIds);
    if (missingRequiredGroups(item, selection).length > 0) {
      throw new RejectedError('INVALID_ITEMS');
    }
    return buildLine(newLineId(), item, selection, quantity, note ?? '');
  });
  return { lines, total: lines.reduce((sum, line) => sum + lineAmount(line), 0) };
}

/**
 * Notes where each line is cooked and whether it carries the service charge,
 * from the menu as it is when the order is sent.
 */
export const prepareLines = (
  lines: TicketLine[],
  catalog: Pick<Catalog, 'items' | 'categories' | 'stations'>,
): TicketLine[] =>
  lines.map((line) => ({
    ...line,
    stationId: stationFor(catalog, line.menuItemId),
    noServiceCharge: catalog.items.find((item) => item.id === line.menuItemId)?.noServiceCharge === true,
  }));

/** Splits a round into one ticket per station. Lines must already have their stations. */
export function splitIntoTickets(input: {
  orderId: string;
  checkId: string;
  tableName: string;
  round: number;
  lines: TicketLine[];
  sentAt: string;
}): KitchenTicket[] {
  const byStation = new Map<string | null, TicketLine[]>();
  for (const line of input.lines) {
    const station = line.stationId ?? null;
    byStation.set(station, [...(byStation.get(station) ?? []), line]);
  }
  return [...byStation.entries()].map(([stationId, lines]) => ({
    id: ticketIdFor(input.orderId, stationId),
    orderId: input.orderId,
    checkId: input.checkId,
    tableName: input.tableName,
    round: input.round,
    stationId,
    status: 'NEW',
    sentAt: input.sentAt,
    lines,
    updatedAt: input.sentAt,
  }));
}

/** The check after a round is sent, before its bill is worked out again. */
export const withRound = (check: GuestCheck, tickets: KitchenTicket[], now: string): GuestCheck => ({
  ...check,
  rounds: check.rounds + 1,
  ticketIds: [...check.ticketIds, ...tickets.map((ticket) => ticket.id)],
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Tables and the waitlist
// ---------------------------------------------------------------------------

export const MAX_PARTY_SIZE = 50;
const MAX_PHONE_LENGTH = 20;

export const isPartySize = (value: number) => Number.isInteger(value) && value >= 1 && value <= MAX_PARTY_SIZE;

export function newCheck(input: {
  id: string;
  tableId: string;
  tableName: string;
  guestCount: number;
  partyName?: string | null;
  serviceChargeRate: number;
  now: string;
}): GuestCheck {
  if (!isPartySize(input.guestCount)) throw new RejectedError('INVALID_GUESTS');
  return {
    id: input.id,
    tableId: input.tableId,
    tableName: input.tableName,
    guestCount: input.guestCount,
    partyName: input.partyName ?? null,
    status: 'OPEN',
    openedAt: input.now,
    rounds: 0,
    ticketIds: [],
    discounts: [],
    serviceChargeRate: input.serviceChargeRate,
    itemsTotal: 0,
    discountTotal: 0,
    serviceCharge: 0,
    billTotal: 0,
    paidTotal: 0,
    paidLineKeys: [],
    updatedAt: input.now,
  };
}

const MAX_BOOKING_NOTE_LENGTH = 200;
const BOOKING_HORIZON_MS = 180 * 86_400_000;

/**
 * Checks what the front desk typed. A phone number is optional. A booking has
 * reservedFor, which may be up to a day late, for entering one after the fact.
 */
export function newWaitlistEntry(
  input: {
    id: string;
    name: string;
    partySize: number;
    phone?: string | null;
    reservedFor?: string | null;
    note?: string | null;
  },
  now: string,
): WaitlistEntry {
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  const note = input.note?.trim() || null;
  const due = input.reservedFor ? Date.parse(input.reservedFor) : undefined;
  const at = Date.parse(now);
  if (
    !name ||
    name.length > MAX_NAME_LENGTH ||
    !isPartySize(input.partySize) ||
    (phone && (phone.length > MAX_PHONE_LENGTH || !/^[0-9+\-\s()]+$/.test(phone))) ||
    (note && note.length > MAX_BOOKING_NOTE_LENGTH) ||
    (due !== undefined && (Number.isNaN(due) || due < at - 86_400_000 || due > at + BOOKING_HORIZON_MS))
  ) {
    throw new RejectedError('WAITLIST_INVALID');
  }
  return {
    id: input.id,
    name,
    partySize: input.partySize,
    phone,
    reservedFor: due === undefined ? null : new Date(due).toISOString(),
    note,
    status: 'WAITING',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Cancelling lines
// ---------------------------------------------------------------------------

export const VOID_REASONS = ['點錯', '客人取消', '缺料', '上菜太慢', '其他'];
export const MAX_REASON_LENGTH = 100;

/**
 * Whether a line may be asked to be cancelled. Once someone has paid, the bill is
 * not reduced any more, because that would mean a refund.
 */
export function voidableLine(
  check: GuestCheck | undefined,
  ticket: KitchenTicket | undefined,
  lineId: string,
  existing: LineVoid | undefined,
): TicketLine {
  const line = ticket?.lines.find((candidate) => candidate.id === lineId);
  if (!check || !ticket || !line || ticket.checkId !== check.id) throw new RejectedError('LINE_NOT_FOUND');
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.paidTotal > 0) throw new RejectedError('CHECK_PAYING');
  if (existing && existing.status !== 'REJECTED') throw new RejectedError('VOID_EXISTS');
  return line;
}

export const isReason = (reason: string) => reason.trim().length > 0 && reason.length <= MAX_REASON_LENGTH;

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

export const DISCOUNT_REASONS = ['熟客', '招待', '餐點問題', '等候太久', '店內活動', '其他'];

export interface DiscountRequest {
  id: string;
  kind: DiscountKind;
  value: number;
  lineKey?: string | null;
  reason: string;
}

const isActive = (discount: Discount) => discount.status !== 'REJECTED';

/**
 * Checks a discount request against the bill. Like a cancellation, it is not
 * allowed once someone has paid. A line, and the bill, have one discount each.
 */
export function newDiscount(
  check: GuestCheck,
  bill: Bill,
  request: DiscountRequest,
  by: { name: string; approver: boolean },
  now: string,
): Discount {
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.paidTotal > 0) throw new RejectedError('CHECK_PAYING');
  const reason = request.reason.trim();
  if (!isReason(reason)) throw new RejectedError('INVALID_REASON');
  const { kind, value } = request;
  const lineKey = isLineDiscount(kind) ? request.lineKey : null;
  const percent = kind === 'CHECK_PERCENT' || kind === 'LINE_PERCENT';
  const amount = kind === 'CHECK_AMOUNT' || kind === 'LINE_AMOUNT';
  if (
    !['CHECK_PERCENT', 'CHECK_AMOUNT', 'LINE_COMP', 'LINE_PERCENT', 'LINE_AMOUNT'].includes(kind) ||
    !Number.isInteger(value) ||
    (percent && (value < 1 || value > 100)) ||
    (amount && (value < 1 || value > MAX_PRICE)) ||
    (kind === 'LINE_COMP' && value !== 0)
  ) {
    throw new RejectedError('INVALID_DISCOUNT');
  }
  if (lineKey) {
    const billed = bill.byKey[lineKey];
    if (!billed) throw new RejectedError('LINE_NOT_FOUND');
    if (kind === 'LINE_AMOUNT' && value > billed.amount) throw new RejectedError('INVALID_DISCOUNT');
  } else if (isLineDiscount(kind)) {
    throw new RejectedError('LINE_NOT_FOUND');
  }
  const taken = check.discounts.some(
    (discount) => isActive(discount) && (lineKey ? discount.lineKey === lineKey : !isLineDiscount(discount.kind)),
  );
  if (taken) throw new RejectedError('DISCOUNT_EXISTS');
  return {
    id: request.id,
    kind,
    value,
    lineKey,
    reason,
    status: by.approver ? 'APPROVED' : 'REQUESTED',
    requestedBy: by.name,
    requestedAt: now,
    decidedBy: by.approver ? by.name : null,
    decidedAt: by.approver ? now : null,
  };
}

/** The check's discounts after a supervisor decides on one. */
export function decidedDiscounts(check: GuestCheck, id: string, approve: boolean, by: string, now: string) {
  const discount = check.discounts.find((candidate) => candidate.id === id);
  if (!discount) throw new RejectedError('DISCOUNT_NOT_FOUND');
  if (discount.status !== 'REQUESTED') throw new RejectedError('VOID_DECIDED');
  if (approve && check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (approve && check.paidTotal > 0) throw new RejectedError('CHECK_PAYING');
  const decided: Discount = { ...discount, status: approve ? 'APPROVED' : 'REJECTED', decidedBy: by, decidedAt: now };
  return check.discounts.map((candidate) => (candidate.id === id ? decided : candidate));
}

/** The check's discounts with one taken back. Not once someone has paid. */
export function withoutDiscount(check: GuestCheck, id: string) {
  if (!check.discounts.some((discount) => discount.id === id)) throw new RejectedError('DISCOUNT_NOT_FOUND');
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.paidTotal > 0) throw new RejectedError('CHECK_PAYING');
  return check.discounts.filter((discount) => discount.id !== id);
}

/** 10 percent off reads 9 折, 15 percent off reads 85 折. */
export function foldLabel(percentOff: number) {
  const fold = 100 - percentOff;
  if (fold <= 0) return '免費';
  return `${fold % 10 === 0 ? fold / 10 : fold} 折`;
}

export function describeDiscount(discount: Pick<Discount, 'kind' | 'value'>) {
  switch (discount.kind) {
    case 'CHECK_PERCENT':
      return `整單打 ${foldLabel(discount.value)}`;
    case 'CHECK_AMOUNT':
      return `整單折 ${formatMoney(discount.value)}`;
    case 'LINE_COMP':
      return '招待';
    case 'LINE_PERCENT':
      return `打 ${foldLabel(discount.value)}`;
    case 'LINE_AMOUNT':
      return `折 ${formatMoney(discount.value)}`;
  }
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

export interface PaymentRequest {
  kind: PaymentKind;
  /** AMOUNT only. */
  amount?: number | null;
  /** SHARE only: the number of equal shares the balance is split into. */
  parts?: number | null;
  /** LINES only. */
  lineKeys?: string[] | null;
}
export const MAX_SPLIT_PARTS = 20;
const MAX_PAYMENT_LINES = 200;

/**
 * Works out what a payment comes to. The server does it again from its own
 * copy of the bill, so what a device sends is only an estimate.
 */
export function paymentAmount(
  check: GuestCheck,
  request: PaymentRequest,
  bill: Pick<Bill, 'lines' | 'byKey'>,
): { amount: number; lineKeys: string[] } {
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  const balance = balanceOf(check);
  if (balance <= 0) throw new RejectedError('NOTHING_TO_PAY');
  let amount: number;
  let lineKeys: string[] = [];
  switch (request.kind) {
    case 'BALANCE':
      amount = balance;
      break;
    case 'AMOUNT':
      amount = request.amount ?? Number.NaN;
      break;
    case 'SHARE': {
      const parts = request.parts ?? Number.NaN;
      if (!Number.isInteger(parts) || parts < 1 || parts > MAX_SPLIT_PARTS) {
        throw new RejectedError('INVALID_PAYMENT');
      }
      // Rounding up keeps the last share from being left a dollar short.
      amount = Math.ceil(balance / parts);
      break;
    }
    case 'LINES': {
      lineKeys = [...new Set(request.lineKeys ?? [])];
      if (lineKeys.length === 0 || lineKeys.length > MAX_PAYMENT_LINES) {
        throw new RejectedError('INVALID_PAYMENT');
      }
      if (lineKeys.some((key) => check.paidLineKeys.includes(key))) {
        throw new RejectedError('LINE_ALREADY_PAID');
      }
      amount = 0;
      for (const key of lineKeys) {
        const line = bill.byKey[key];
        if (!line) throw new RejectedError('LINE_NOT_FOUND');
        amount += line.payable;
      }
      // Each line's share is rounded, so whoever pays for the last lines pays what is left.
      const unpaid = bill.lines.filter((line) => !check.paidLineKeys.includes(line.key));
      if (unpaid.every((line) => lineKeys.includes(line.key))) amount = balance;
      break;
    }
    default:
      throw new RejectedError('INVALID_PAYMENT');
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > balance) {
    throw new RejectedError('INVALID_PAYMENT');
  }
  return { amount, lineKeys };
}

/** The check after a payment. Paying the last of the balance closes it. */
export function withPayment(check: GuestCheck, payment: Payment, now: string): GuestCheck {
  const paidTotal = check.paidTotal + payment.amount;
  const paid: GuestCheck = {
    ...check,
    paidTotal,
    paidLineKeys: [...check.paidLineKeys, ...payment.lineKeys],
    updatedAt: now,
  };
  return paidTotal >= check.billTotal ? closeCheckRecord(paid, now) : paid;
}

export const closeCheckRecord = (check: GuestCheck, now: string): GuestCheck => ({
  ...check,
  status: 'CLOSED',
  closedAt: now,
  closedDate: businessDate(now),
  updatedAt: now,
});

/** Checks a 統一編號 with its check digit. A seventh digit of 7 may count as 0 or 1. */
export function isTaxId(value: string) {
  if (!/^\d{8}$/.test(value)) return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  const digitSum = (n: number) => Math.floor(n / 10) + (n % 10);
  const sum = [...value].reduce((total, digit, index) => total + digitSum(Number(digit) * weights[index]), 0);
  return sum % 5 === 0 || (value[6] === '7' && (sum + 1) % 5 === 0);
}

/**
 * Tidies and checks what the payer wants on their e-invoice. A donated invoice
 * cannot carry a 統一編號 or go to a carrier.
 */
export function checkInvoice(invoice: InvoiceRequest): InvoiceRequest {
  const carrierId = invoice.carrierId?.trim().toUpperCase() || null;
  const buyerTaxId = invoice.buyerTaxId?.trim() || null;
  const donationCode = invoice.donationCode?.trim() || null;
  const carrierOk =
    invoice.carrierType === 'NONE'
      ? !carrierId
      : invoice.carrierType === 'MOBILE'
        ? Boolean(carrierId && /^\/[0-9A-Z.+-]{7}$/.test(carrierId))
        : invoice.carrierType === 'CERTIFICATE'
          ? Boolean(carrierId && /^[A-Z]{2}\d{14}$/.test(carrierId))
          : false;
  if (
    !carrierOk ||
    (buyerTaxId && !isTaxId(buyerTaxId)) ||
    (donationCode && (!/^\d{3,7}$/.test(donationCode) || buyerTaxId || invoice.carrierType !== 'NONE'))
  ) {
    throw new RejectedError('INVALID_INVOICE');
  }
  return { carrierType: invoice.carrierType, carrierId, buyerTaxId, donationCode };
}

export const CARRIER_LABEL: Record<CarrierType, string> = {
  NONE: '紙本',
  MOBILE: '手機條碼',
  CERTIFICATE: '自然人憑證',
};

export function describeInvoice(invoice: InvoiceRequest) {
  if (invoice.donationCode) return `捐贈 ${invoice.donationCode}`;
  const parts = [invoice.carrierType === 'NONE' ? '紙本' : `${CARRIER_LABEL[invoice.carrierType]} ${invoice.carrierId}`];
  if (invoice.buyerTaxId) parts.push(`統編 ${invoice.buyerTaxId}`);
  return parts.join('・');
}

/** Who still has to pay their share, when a bill is being split equally. */
export function sharesLeft(payments: Payment[]): number | undefined {
  const last = payments.at(-1);
  return last?.kind === 'SHARE' && last.parts && last.parts > 1 ? last.parts - 1 : undefined;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const formatMoney = (amount: number) => `NT$${amount.toLocaleString('en-US')}`;

export const elapsedMinutes = (fromIso: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  });

// ---------------------------------------------------------------------------
// Editing the catalog
// ---------------------------------------------------------------------------

/** A manager's edit to the menu, stations or tables. Applied together, so a reorder is one change. */
export type CatalogChange =
  | { type: 'category/save'; category: MenuCategory; isNew: boolean }
  | { type: 'category/delete'; id: string }
  | { type: 'item/save'; item: MenuItem; isNew: boolean }
  | { type: 'item/delete'; id: string }
  | { type: 'table/save'; table: DiningTable; isNew: boolean }
  | { type: 'table/delete'; id: string }
  | { type: 'station/save'; station: Station; isNew: boolean }
  | { type: 'station/delete'; id: string }
  | { type: 'settings/save'; settings: StoreSettings };

const upsertRecord = <T extends { id: string }>(records: T[], record: T) =>
  records.some((candidate) => candidate.id === record.id)
    ? records.map((candidate) => (candidate.id === record.id ? record : candidate))
    : [...records, record];

/**
 * Saving keeps what other screens own: an item's sold out flag and a table's QR
 * token. An editor may hold an older copy of either.
 */
export function applyCatalogChange(catalog: Catalog, change: CatalogChange): Catalog {
  const bySort = <T extends { sortOrder: number }>(records: T[]) =>
    [...records].sort((a, b) => a.sortOrder - b.sortOrder);
  switch (change.type) {
    case 'category/save':
      return { ...catalog, categories: bySort(upsertRecord(catalog.categories, change.category)) };
    case 'category/delete':
      return { ...catalog, categories: catalog.categories.filter((c) => c.id !== change.id) };
    case 'item/save': {
      const current = catalog.items.find((item) => item.id === change.item.id);
      const item = { ...change.item, available: change.isNew ? null : current?.available };
      return { ...catalog, items: bySort(upsertRecord(catalog.items, item)) };
    }
    case 'item/delete':
      return { ...catalog, items: catalog.items.filter((item) => item.id !== change.id) };
    case 'table/save': {
      const current = catalog.tables.find((table) => table.id === change.table.id);
      const table = { ...change.table, qrToken: change.isNew ? change.table.qrToken : current?.qrToken };
      return { ...catalog, tables: bySort(upsertRecord(catalog.tables, table)) };
    }
    case 'table/delete':
      return { ...catalog, tables: catalog.tables.filter((table) => table.id !== change.id) };
    case 'station/save':
      return { ...catalog, stations: bySort(upsertRecord(catalog.stations, change.station)) };
    case 'station/delete':
      return { ...catalog, stations: catalog.stations.filter((station) => station.id !== change.id) };
    case 'settings/save':
      return { ...catalog, settings: change.settings };
  }
}

export const MAX_NAME_LENGTH = 40;
export const MAX_PRICE = 100_000;

const isPrice = (value: number, min: number) =>
  Number.isInteger(value) && value >= min && value <= MAX_PRICE;

/** What stops an item being saved, worded for the manager editing it. */
export function menuItemProblems(item: MenuItem): string[] {
  const problems: string[] = [];
  const badName = (name: string) => !name.trim() || name.trim().length > MAX_NAME_LENGTH;
  if (badName(item.name)) problems.push(`品名必填，最多 ${MAX_NAME_LENGTH} 字`);
  if (!isPrice(item.price, 0)) problems.push(`價格要是 0 到 ${MAX_PRICE} 的整數`);
  item.optionGroups.forEach((group, index) => {
    const label = group.name.trim() || `第 ${index + 1} 組選項`;
    if (badName(group.name)) problems.push(`第 ${index + 1} 組選項需要名稱`);
    if (group.choices.length === 0) problems.push(`「${label}」至少要有一個選項`);
    if (group.choices.some((choice) => badName(choice.name))) {
      problems.push(`「${label}」的每個選項都需要名稱`);
    }
    if (group.choices.some((choice) => !isPrice(Math.abs(choice.priceDelta), 0))) {
      problems.push(`「${label}」的加價要是整數`);
    }
    if (new Set(group.choices.map((choice) => choice.name.trim())).size < group.choices.length) {
      problems.push(`「${label}」有重複的選項`);
    }
  });
  return problems;
}

/** What stops the settings being saved. */
export function settingsProblems(settings: StoreSettings): string[] {
  const problems: string[] = [];
  const rate = settings.serviceChargeRate;
  if (!Number.isInteger(rate) || rate < 0 || rate > MAX_SERVICE_CHARGE_RATE) {
    problems.push(`服務費要是 0 到 ${MAX_SERVICE_CHARGE_RATE} 的整數`);
  }
  if (settings.storeName.trim().length > MAX_NAME_LENGTH) problems.push(`店名最多 ${MAX_NAME_LENGTH} 字`);
  if (settings.taxId && !isTaxId(settings.taxId)) problems.push('統一編號不正確');
  return problems;
}

/** A sort order after every existing one. */
export const nextSortOrder = (records: { sortOrder: number }[]) =>
  records.reduce((max, record) => Math.max(max, record.sortOrder), 0) + 10;

/**
 * Swaps a record with its neighbour in a list sorted by sort order. Returns the
 * records to save, or nothing at either end.
 */
export function moveBy<T extends { id: string; sortOrder: number }>(
  records: T[],
  id: string,
  offset: -1 | 1,
): T[] | undefined {
  const index = records.findIndex((record) => record.id === id);
  const record = records[index];
  const neighbour = records[index + offset];
  if (!record || !neighbour) return undefined;
  // Equal sort orders would not swap, so the moved record steps past instead.
  if (record.sortOrder === neighbour.sortOrder) {
    return [{ ...record, sortOrder: record.sortOrder + offset }];
  }
  return [
    { ...record, sortOrder: neighbour.sortOrder },
    { ...neighbour, sortOrder: record.sortOrder },
  ];
}

// ---------------------------------------------------------------------------
// Staff accounts
// ---------------------------------------------------------------------------

export type StaffRejection =
  | 'STAFF_EXISTS'
  | 'INVALID_EMAIL'
  | 'INVALID_ROLES'
  | 'STAFF_NOT_FOUND'
  | 'ALREADY_SIGNED_IN'
  | 'EMAIL_FAILED'
  | 'CANNOT_CHANGE_SELF';

export const STAFF_REJECTION_MESSAGE: Record<StaffRejection, string> = {
  STAFF_EXISTS: '這個 Email 已經有帳號',
  INVALID_EMAIL: 'Email 格式不正確',
  INVALID_ROLES: '請至少選擇一個角色',
  STAFF_NOT_FOUND: '找不到這個帳號，請重新整理',
  ALREADY_SIGNED_IN: '這個帳號已經登入過，不需要重寄邀請。忘記密碼可在登入畫面重設',
  EMAIL_FAILED: '邀請信寄送失敗，可能是 Email 有誤或今天寄送已達上限，請稍後再試',
  CANNOT_CHANGE_SELF: '不能變更自己的角色，也不能停用自己',
};

/** Thrown when an account change is refused. Its message is the code. */
export class StaffRejectedError extends Error {
  constructor(readonly code: StaffRejection) {
    super(code);
  }
}

export interface StaffMember {
  username: string;
  email: string;
  roles: Role[];
  enabled: boolean;
  /** True until they sign in and replace the temporary password. */
  invited: boolean;
  isSelf: boolean;
}

// ---------------------------------------------------------------------------
// Business days and the daily report
// ---------------------------------------------------------------------------

/** The restaurant's clock. Taiwan has no daylight saving, so a fixed offset is exact. */
export const BUSINESS_UTC_OFFSET_MINUTES = 8 * 60;
const OFFSET_MS = BUSINESS_UTC_OFFSET_MINUTES * 60_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date, in the restaurant's time zone, of an instant. */
export const businessDate = (iso: string | number) =>
  new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 10);

export const isBusinessDate = (date: string) =>
  DATE_PATTERN.test(date) && businessDate(`${date}T00:00:00.000Z`) === date;

/** The UTC instants a business date starts and ends at. The end is exclusive. */
export function businessDay(date: string): { start: string; end: string } {
  if (!isBusinessDate(date)) throw new Error(`not a date: ${date}`);
  const start = Date.parse(`${date}T00:00:00.000Z`) - OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}

export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Payments taken on a business date, and the checks paid off that day with what was on them. */
export interface DailyRecords {
  payments: Payment[];
  checks: GuestCheck[];
  tickets: KitchenTicket[];
  voids: LineVoid[];
}
export interface ItemSales {
  menuItemId: string;
  name: string;
  quantity: number;
  amount: number;
  voidedQuantity: number;
}
export interface VoidedLine {
  decidedAt: string;
  tableName: string;
  name: string;
  quantity: number;
  amount: number;
  reason: string;
  requestedBy: string;
  decidedBy: string;
}
export interface DiscountLine {
  decidedAt: string;
  tableName: string;
  /** What it was for: the line's name, or the whole bill. */
  target: string;
  description: string;
  amount: number;
  reason: string;
  requestedBy: string;
  decidedBy: string;
}
export interface DailyReport {
  /** Checks paid off that day. */
  checks: number;
  guests: number;
  /** What was ordered on those checks, less cancellations. */
  itemsTotal: number;
  discountTotal: number;
  serviceCharge: number;
  /** What those checks came to. */
  billed: number;
  discounts: DiscountLine[];
  received: number;
  byMethod: Record<PaymentMethod, { count: number; amount: number }>;
  /** Highest takings first. Cancelled quantities are counted apart. */
  items: ItemSales[];
  voids: VoidedLine[];
}

/**
 * Takings count on the day they were paid. Items count on the day their check
 * was paid off, so a check paid across midnight is not split between two days.
 */
export function dailyReport({ payments, checks, tickets, voids }: DailyRecords): DailyReport {
  const byMethod: DailyReport['byMethod'] = { CASH: { count: 0, amount: 0 }, CARD: { count: 0, amount: 0 } };
  for (const payment of payments) {
    byMethod[payment.method].count += 1;
    byMethod[payment.method].amount += payment.amount;
  }
  const closed = checks.filter((check) => check.status === 'CLOSED');
  const checkIds = new Set(closed.map((check) => check.id));
  const voidById = new Map(voids.map((lineVoid) => [lineVoid.id, lineVoid]));
  const items = new Map<string, ItemSales>();
  const voidedLines: VoidedLine[] = [];

  for (const ticket of tickets) {
    if (!checkIds.has(ticket.checkId)) continue;
    for (const line of ticket.lines) {
      const key = `${line.menuItemId}\u0000${line.name}`;
      const sales = items.get(key) ?? {
        menuItemId: line.menuItemId,
        name: line.name,
        quantity: 0,
        amount: 0,
        voidedQuantity: 0,
      };
      const lineVoid = voidById.get(voidId(ticket.id, line.id));
      if (lineVoid?.status === 'APPROVED') {
        sales.voidedQuantity += line.quantity;
        voidedLines.push({
          decidedAt: lineVoid.decidedAt ?? lineVoid.requestedAt,
          tableName: ticket.tableName,
          name: line.name,
          quantity: line.quantity,
          amount: lineAmount(line),
          reason: lineVoid.reason,
          requestedBy: lineVoid.requestedBy,
          decidedBy: lineVoid.decidedBy ?? lineVoid.requestedBy,
        });
      } else {
        sales.quantity += line.quantity;
        sales.amount += lineAmount(line);
      }
      items.set(key, sales);
    }
  }

  const voidRecords = Object.fromEntries(voids.map((lineVoid) => [lineVoid.id, lineVoid]));
  const discounts = closed.flatMap((check) => {
    const bill = billOf(check, tickets.filter((ticket) => ticket.checkId === check.id), voidRecords);
    return check.discounts
      .filter((discount) => discount.status === 'APPROVED')
      .flatMap((discount): DiscountLine[] => {
        const line = discount.lineKey ? bill.byKey[discount.lineKey] : undefined;
        if (discount.lineKey && !line) return []; // The line was cancelled, so the discount came to nothing.
        return [
          {
            decidedAt: discount.decidedAt ?? discount.requestedAt,
            tableName: check.tableName,
            target: line ? `${line.line.name} × ${line.line.quantity}` : '整張帳單',
            description: describeDiscount(discount),
            amount: line ? line.amount - line.net : bill.checkDiscount,
            reason: discount.reason,
            requestedBy: discount.requestedBy,
            decidedBy: discount.decidedBy ?? discount.requestedBy,
          },
        ];
      });
  });
  const sum = (field: 'itemsTotal' | 'discountTotal' | 'serviceCharge' | 'billTotal') =>
    closed.reduce((total, check) => total + check[field], 0);

  return {
    checks: closed.length,
    guests: closed.reduce((total, check) => total + (check.guestCount ?? 0), 0),
    itemsTotal: sum('itemsTotal'),
    discountTotal: sum('discountTotal'),
    serviceCharge: sum('serviceCharge'),
    billed: sum('billTotal'),
    discounts: discounts.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
    received: byMethod.CASH.amount + byMethod.CARD.amount,
    byMethod,
    items: [...items.values()].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity),
    voids: voidedLines.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
  };
}

// ---------------------------------------------------------------------------
// The kitchen report
// ---------------------------------------------------------------------------

/** Average minutes for each step, over the tickets that went through it. */
export interface Timing {
  tickets: number;
  /** Sent until a cook started it. */
  waiting?: number;
  /** Started until finished. */
  cooking?: number;
  /** Finished until served, which is waiting on other stations or a server. */
  passing?: number;
  /** Sent until served. */
  total?: number;
  /** Tickets that took at least LATE_MINUTES from sent to finished. */
  late: number;
}
export interface KitchenReport {
  stations: (Timing & { stationId: string | null })[];
  /** Slowest first. Only items on at least two tickets, so one bad night does not top the list. */
  items: (Timing & { name: string })[];
  /** The slowest tickets, sent to finished. */
  slowest: { ticket: KitchenTicket; minutes: number }[];
}
export const LATE_MINUTES = 20;

const minutesBetween = (from?: string | null, to?: string | null) =>
  from && to ? Math.max(0, (Date.parse(to) - Date.parse(from)) / 60_000) : undefined;

function timing(tickets: KitchenTicket[]): Timing {
  const average = (values: (number | undefined)[]) => {
    const known = values.filter((value): value is number => value !== undefined);
    return known.length ? Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 10) / 10 : undefined;
  };
  return {
    tickets: tickets.length,
    waiting: average(tickets.map((ticket) => minutesBetween(ticket.sentAt, ticket.startedAt))),
    cooking: average(tickets.map((ticket) => minutesBetween(ticket.startedAt, ticket.readyAt))),
    passing: average(tickets.map((ticket) => minutesBetween(ticket.readyAt, ticket.servedAt))),
    total: average(tickets.map((ticket) => minutesBetween(ticket.sentAt, ticket.servedAt))),
    late: tickets.filter((ticket) => (minutesBetween(ticket.sentAt, ticket.readyAt) ?? 0) >= LATE_MINUTES).length,
  };
}

/** How long the kitchen took on the tickets of the bills paid off that day, to find where it waits. */
export function kitchenReport({ tickets, voids }: Pick<DailyRecords, 'tickets' | 'voids'>): KitchenReport {
  const voidRecords = Object.fromEntries(voids.map((lineVoid) => [lineVoid.id, lineVoid]));
  const cooked = tickets.filter((ticket) => !isFullyVoided({ voids: voidRecords }, ticket) && ticket.readyAt);
  const stations = new Map<string | null, KitchenTicket[]>();
  const items = new Map<string, KitchenTicket[]>();
  for (const ticket of cooked) {
    const station = ticket.stationId ?? null;
    stations.set(station, [...(stations.get(station) ?? []), ticket]);
    for (const name of new Set(ticket.lines.map((line) => line.name))) {
      items.set(name, [...(items.get(name) ?? []), ticket]);
    }
  }
  const cookingTime = (entry: Timing) => (entry.waiting ?? 0) + (entry.cooking ?? 0);
  return {
    stations: [...stations.entries()]
      .map(([stationId, list]) => ({ stationId, ...timing(list) }))
      .sort((a, b) => cookingTime(b) - cookingTime(a)),
    items: [...items.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([name, list]) => ({ name, ...timing(list) }))
      .sort((a, b) => cookingTime(b) - cookingTime(a))
      .slice(0, 10),
    slowest: cooked
      .map((ticket) => ({ ticket, minutes: Math.round(minutesBetween(ticket.sentAt, ticket.readyAt) ?? 0) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10),
  };
}
