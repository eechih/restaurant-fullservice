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
  | 'approveVoid'
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
  approveVoid: ['MANAGER', 'SUPERVISOR'],
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
export interface Catalog {
  tables: DiningTable[];
  categories: MenuCategory[];
  items: MenuItem[];
  stations: Station[];
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
  /** What was ordered, less approved cancellations. */
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
}

export type WaitlistStatus = 'WAITING' | 'SEATED' | 'CANCELLED';
export interface WaitlistEntry {
  id: string;
  name: string;
  partySize: number;
  phone?: string | null;
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
  WAITLIST_INVALID: '候位資料有誤，請確認稱呼和人數',
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

export const waitingParties = (state: LiveState): WaitlistEntry[] =>
  Object.values(state.waitlist)
    .filter((entry) => entry.status === 'WAITING')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** Empty tables that seat the party, the closest fit first. */
export function suggestTables(catalog: Pick<Catalog, 'tables'>, state: LiveState, partySize: number) {
  return catalog.tables
    .filter((table) => tableState(state, table.id) === 'EMPTY' && table.seats >= partySize)
    .sort((a, b) => a.seats - b.seats || a.sortOrder - b.sortOrder);
}

/** Finds a line on a bill, with what it is worth, while it is still billed. */
export function billedLine(
  state: Pick<LiveState, 'tickets' | 'voids'>,
  checkId: string,
  key: string,
): { ticket: KitchenTicket; line: TicketLine; amount: number } | undefined {
  const parsed = parseLineKey(key);
  const ticket = parsed && state.tickets[parsed.ticketId];
  const line = ticket?.lines.find((candidate) => candidate.id === parsed?.lineId);
  if (!ticket || !line || ticket.checkId !== checkId || isLineVoided(state, ticket.id, line.id)) return undefined;
  return { ticket, line, amount: lineAmount(line) };
}

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

/** Tells each line where it is cooked, from the menu as it is when the order is sent. */
export const assignStations = (
  lines: TicketLine[],
  catalog: Pick<Catalog, 'items' | 'categories' | 'stations'>,
): TicketLine[] => lines.map((line) => ({ ...line, stationId: stationFor(catalog, line.menuItemId) }));

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

/** The check after a round is sent: one more round, and its total on the bill. */
export const withRound = (check: GuestCheck, total: number, now: string): GuestCheck => ({
  ...check,
  rounds: check.rounds + 1,
  billTotal: check.billTotal + total,
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
    billTotal: 0,
    paidTotal: 0,
    paidLineKeys: [],
    updatedAt: input.now,
  };
}

/** Checks what the front desk typed. A phone number is optional. */
export function newWaitlistEntry(
  input: { id: string; name: string; partySize: number; phone?: string | null },
  now: string,
): WaitlistEntry {
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  if (
    !name ||
    name.length > MAX_NAME_LENGTH ||
    !isPartySize(input.partySize) ||
    (phone && (phone.length > MAX_PHONE_LENGTH || !/^[0-9+\-\s()]+$/.test(phone)))
  ) {
    throw new RejectedError('WAITLIST_INVALID');
  }
  return { id: input.id, name, partySize: input.partySize, phone, status: 'WAITING', createdAt: now, updatedAt: now };
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
 * amountOf returns what a line is worth while it is still on this bill.
 */
export function paymentAmount(
  check: GuestCheck,
  request: PaymentRequest,
  amountOf: (lineKey: string) => number | undefined,
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
        const value = amountOf(key);
        if (value === undefined) throw new RejectedError('LINE_NOT_FOUND');
        amount += value;
      }
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
  | { type: 'station/delete'; id: string };

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
export interface DailyReport {
  /** Checks paid off that day. */
  checks: number;
  guests: number;
  /** What those checks came to. */
  billed: number;
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

  return {
    checks: closed.length,
    guests: closed.reduce((sum, check) => sum + (check.guestCount ?? 0), 0),
    billed: closed.reduce((sum, check) => sum + check.billTotal, 0),
    received: byMethod.CASH.amount + byMethod.CARD.amount,
    byMethod,
    items: [...items.values()].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity),
    voids: voidedLines.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
  };
}
