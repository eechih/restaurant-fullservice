export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED';
/** EXPIRED is derived from expiresAt; stored orders are only PENDING or PAID. */
export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED';
export type PaymentMethod = 'CASH' | 'CARD';

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
export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  sortOrder: number;
  optionGroups: OptionGroup[];
  /** False when sold out. Missing means available. */
  available?: boolean | null;
}
export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}
export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  sortOrder: number;
  /** What the table's QR code carries. Customers must never be able to read it. */
  qrToken?: string | null;
}
export interface Catalog {
  tables: DiningTable[];
  categories: MenuCategory[];
  items: MenuItem[];
}

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
}
export interface Seating {
  tableId: string;
  checkId: string;
}
/** One party's stay at a table. Payment lives on each Order. */
export interface GuestCheck {
  id: string;
  tableId: string;
  tableName: string;
  /** Missing when the table was opened by a customer's first paid order. */
  guestCount?: number | null;
  openedAt: string;
}
export interface Order {
  id: string;
  tableId: string;
  tableName: string;
  /** Set when paid, because an unpaid order must not occupy a table. */
  checkId?: string | null;
  status: OrderStatus;
  lines: TicketLine[];
  total: number;
  createdAt: string;
  expiresAt: string;
  paymentMethod?: PaymentMethod | null;
  paidAt?: string | null;
  /** Takeout only. Given when paid, counting from 1 each business day. */
  pickupNumber?: number | null;
}
export interface KitchenTicket {
  id: string;
  checkId: string;
  tableName: string;
  round: number;
  status: TicketStatus;
  sentAt: string;
  lines: TicketLine[];
  /** Takeout only. */
  pickupNumber?: number | null;
}
export interface LineVoid {
  id: string;
  ticketId: string;
  checkId: string;
  lineId: string;
  reason: string;
  voidedAt: string;
}

/** Thrown when the server rejects a write because the record already exists. */
export class ConflictError extends Error {}

export type OrderRejection =
  | 'TABLE_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'INVALID_ITEMS'
  | 'PRICE_CHANGED'
  | 'TOO_MANY_PENDING'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_EXPIRED';

export const ORDER_REJECTION_MESSAGE: Record<OrderRejection, string> = {
  TABLE_NOT_FOUND: '找不到這張桌子',
  ITEM_UNAVAILABLE: '有品項已售完或已下架，請重新點餐',
  INVALID_ITEMS: '點餐內容有誤，請重新點餐',
  PRICE_CHANGED: '菜單價格已變更，請重新點餐',
  TOO_MANY_PENDING: '這桌尚未付款的訂單太多，請先到櫃台付款或稍後再試',
  ORDER_NOT_FOUND: '找不到這筆訂單',
  ORDER_EXPIRED: '這筆訂單已逾時，請重新操作',
};

/** Thrown when an order breaks a business rule. Retrying it will not help. */
export class OrderRejectedError extends Error {
  constructor(readonly code: OrderRejection) {
    super(code);
  }
}

export const voidId = (ticketId: string, lineId: string) => `${ticketId}#${lineId}`;

/**
 * The counter's takeout entry. It is a DiningTable record so that its QR code
 * works like a table's, but it never seats anyone: each paid takeout order gets
 * a check of its own and a pickup number instead.
 */
export const TAKEOUT_TABLE_ID = 'takeout';
export const TAKEOUT_NAME = '外帶';
export const isTakeout = (order: Pick<Order, 'tableId'>) => order.tableId === TAKEOUT_TABLE_ID;
export const pickupLabel = (pickupNumber: number) => `${TAKEOUT_NAME} #${pickupNumber}`;

/** Tables people sit at, leaving out the takeout entry. */
export const diningTables = (catalog: Catalog) =>
  catalog.tables.filter((table) => table.id !== TAKEOUT_TABLE_ID);

/** Takeout tickets still to be handed over, oldest first. */
export const openTakeoutTickets = (state: LiveState) =>
  Object.values(state.tickets)
    .filter((ticket) => ticket.pickupNumber != null && ticket.status !== 'SERVED' && !isFullyVoided(state, ticket))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

/** Fixed per order, so that confirming a payment twice cannot create two tickets. */
export const ticketIdForOrder = (orderId: string) => `order-${orderId}`;

/** A short code customers can read out at the counter. Unique enough within a table. */
export const orderCode = (orderId: string) => orderId.slice(0, 4).toUpperCase();

export interface LiveState {
  seatings: Record<string, Seating>;
  checks: Record<string, GuestCheck>;
  tickets: Record<string, KitchenTicket>;
  voids: Record<string, LineVoid>;
  orders: Record<string, Order>;
}
export const emptyLiveState: LiveState = {
  seatings: {},
  checks: {},
  tickets: {},
  voids: {},
  orders: {},
};

export type LiveEvent =
  | { type: 'seating/upsert'; seating: Seating }
  | { type: 'seating/delete'; tableId: string }
  | { type: 'check/upsert'; check: GuestCheck }
  | { type: 'ticket/upsert'; ticket: KitchenTicket }
  | { type: 'void/upsert'; lineVoid: LineVoid }
  | { type: 'order/upsert'; order: Order };

export function applyEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case 'seating/upsert':
      return { ...state, seatings: { ...state.seatings, [event.seating.tableId]: event.seating } };
    case 'seating/delete': {
      const seatings = { ...state.seatings };
      delete seatings[event.tableId];
      return { ...state, seatings };
    }
    case 'check/upsert':
      return { ...state, checks: { ...state.checks, [event.check.id]: event.check } };
    case 'ticket/upsert':
      return { ...state, tickets: { ...state.tickets, [event.ticket.id]: event.ticket } };
    case 'void/upsert':
      return { ...state, voids: { ...state.voids, [event.lineVoid.id]: event.lineVoid } };
    case 'order/upsert':
      return { ...state, orders: { ...state.orders, [event.order.id]: event.order } };
  }
}

export const lineAmount = (line: TicketLine) => line.unitPrice * line.quantity;

export const isLineVoided = (state: LiveState, ticketId: string, lineId: string) =>
  voidId(ticketId, lineId) in state.voids;

/** True when nothing on the ticket is left to cook or bill. */
export const isFullyVoided = (state: LiveState, ticket: KitchenTicket) =>
  ticket.lines.every((line) => isLineVoided(state, ticket.id, line.id));

export function ticketsForCheck(state: LiveState, checkId: string): KitchenTicket[] {
  return Object.values(state.tickets)
    .filter((ticket) => ticket.checkId === checkId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function billTotal(state: LiveState, checkId: string): number {
  return ticketsForCheck(state, checkId).reduce(
    (sum, ticket) =>
      sum +
      ticket.lines
        .filter((line) => !isLineVoided(state, ticket.id, line.id))
        .reduce((lineSum, line) => lineSum + lineAmount(line), 0),
    0,
  );
}

export const unservedTickets = (state: LiveState, checkId: string) =>
  ticketsForCheck(state, checkId).filter(
    (ticket) => ticket.status !== 'SERVED' && !isFullyVoided(state, ticket),
  );

/** The next round number. Concurrent sends may share one; it is only a label. */
export const nextRound = (state: LiveState, checkId: string) =>
  ticketsForCheck(state, checkId).reduce((max, ticket) => Math.max(max, ticket.round), 0) + 1;

export function ticketsWithStatus(state: LiveState, statuses: TicketStatus[]): KitchenTicket[] {
  return Object.values(state.tickets)
    .filter((ticket) => statuses.includes(ticket.status))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export type TableState = 'EMPTY' | 'DINING';

export const tableState = (state: LiveState, tableId: string): TableState =>
  state.seatings[tableId] ? 'DINING' : 'EMPTY';

export const effectiveOrderStatus = (
  order: Pick<Order, 'status' | 'expiresAt'>,
  now: number,
): OrderStatus =>
  order.status === 'PENDING' && new Date(order.expiresAt).getTime() <= now
    ? 'EXPIRED'
    : order.status;

/** Orders waiting for payment, oldest first. */
export const pendingOrders = (state: LiveState, now: number): Order[] =>
  Object.values(state.orders)
    .filter((order) => effectiveOrderStatus(order, now) === 'PENDING')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

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
 * one link from flooding the staff's pending list. Unpaid orders expire, so a
 * table that reaches it recovers by itself.
 */
export const MAX_PENDING_ORDERS_PER_TABLE = 10;
/** The takeout entry is shared by every takeout customer, so it allows more. */
export const MAX_PENDING_TAKEOUT_ORDERS = 30;
export const pendingLimitFor = (tableId: string) =>
  tableId === TAKEOUT_TABLE_ID ? MAX_PENDING_TAKEOUT_ORDERS : MAX_PENDING_ORDERS_PER_TABLE;
const MAX_ORDER_LINES = 50;
const MAX_LINE_QUANTITY = 99;
const MAX_NOTE_LENGTH = 200;

function selectionFromChoiceIds(item: MenuItem, choiceIds: string[]): OptionSelection {
  const selection: OptionSelection = {};
  for (const choiceId of new Set(choiceIds)) {
    const group = item.optionGroups.find((candidate) =>
      candidate.choices.some((choice) => choice.id === choiceId),
    );
    if (!group) throw new OrderRejectedError('INVALID_ITEMS');
    selection[group.id] = [...(selection[group.id] ?? []), choiceId];
    if (!group.multiple && selection[group.id].length > 1) {
      throw new OrderRejectedError('INVALID_ITEMS');
    }
  }
  return selection;
}

/**
 * Turns what a customer asked for into priced lines. The input may come from an
 * untrusted device, so it is checked here and carries no prices of its own.
 */
export function priceOrder(
  menu: MenuItem[],
  inputs: OrderItemInput[],
  newLineId: () => string,
): { lines: TicketLine[]; total: number } {
  if (inputs.length === 0 || inputs.length > MAX_ORDER_LINES) {
    throw new OrderRejectedError('INVALID_ITEMS');
  }
  const lines = inputs.map(({ menuItemId, quantity, choiceIds, note }) => {
    const item = menu.find((candidate) => candidate.id === menuItemId);
    if (!item || item.available === false) throw new OrderRejectedError('ITEM_UNAVAILABLE');
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY ||
      (note?.length ?? 0) > MAX_NOTE_LENGTH
    ) {
      throw new OrderRejectedError('INVALID_ITEMS');
    }
    const selection = selectionFromChoiceIds(item, choiceIds);
    if (missingRequiredGroups(item, selection).length > 0) {
      throw new OrderRejectedError('INVALID_ITEMS');
    }
    return buildLine(newLineId(), item, selection, quantity, note ?? '');
  });
  return { lines, total: lines.reduce((sum, line) => sum + lineAmount(line), 0) };
}

export const formatMoney = (amount: number) => `NT$${amount.toLocaleString('en-US')}`;

export const elapsedMinutes = (fromIso: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));

/** A manager's edit to the menu or tables. Applied together, so a reorder is one change. */
export type CatalogChange =
  | { type: 'category/save'; category: MenuCategory; isNew: boolean }
  | { type: 'category/delete'; id: string }
  | { type: 'item/save'; item: MenuItem; isNew: boolean }
  | { type: 'item/delete'; id: string }
  | { type: 'table/save'; table: DiningTable; isNew: boolean }
  | { type: 'table/delete'; id: string };

const upsert = <T extends { id: string }>(records: T[], record: T) =>
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
      return { ...catalog, categories: bySort(upsert(catalog.categories, change.category)) };
    case 'category/delete':
      return { ...catalog, categories: catalog.categories.filter((c) => c.id !== change.id) };
    case 'item/save': {
      const current = catalog.items.find((item) => item.id === change.item.id);
      const item = { ...change.item, available: change.isNew ? null : current?.available };
      return { ...catalog, items: bySort(upsert(catalog.items, item)) };
    }
    case 'item/delete':
      return { ...catalog, items: catalog.items.filter((item) => item.id !== change.id) };
    case 'table/save': {
      const current = catalog.tables.find((table) => table.id === change.table.id);
      const table = { ...change.table, qrToken: change.isNew ? change.table.qrToken : current?.qrToken };
      return { ...catalog, tables: bySort(upsert(catalog.tables, table)) };
    }
    case 'table/delete':
      return { ...catalog, tables: catalog.tables.filter((table) => table.id !== change.id) };
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

/** The Cognito group whose members may edit the menu, tables and staff accounts. */
export const MANAGER_GROUP = 'MANAGER';
export type StaffRole = 'MANAGER' | 'STAFF';

export type StaffRejection =
  | 'STAFF_EXISTS'
  | 'INVALID_EMAIL'
  | 'STAFF_NOT_FOUND'
  | 'ALREADY_SIGNED_IN'
  | 'EMAIL_FAILED'
  | 'CANNOT_CHANGE_SELF';

export const STAFF_REJECTION_MESSAGE: Record<StaffRejection, string> = {
  STAFF_EXISTS: '這個 Email 已經有帳號',
  INVALID_EMAIL: 'Email 格式不正確',
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
  role: StaffRole;
  enabled: boolean;
  /** True until they sign in and replace the temporary password. */
  invited: boolean;
  isSelf: boolean;
}

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

export interface PaymentSummary {
  orders: number;
  received: number;
  refunded: number;
}
export interface ItemSales {
  menuItemId: string;
  name: string;
  quantity: number;
  amount: number;
  voidedQuantity: number;
}
export interface RefundLine {
  voidedAt: string;
  tableName: string;
  name: string;
  quantity: number;
  amount: number;
  reason: string;
  paymentMethod: PaymentMethod;
}
export interface DailyReport {
  orders: number;
  received: number;
  refunded: number;
  /** The takeout share of orders and takings. */
  takeout: { orders: number; received: number };
  byPayment: Record<PaymentMethod, PaymentSummary>;
  /** Highest takings first. Cancelled quantities are counted apart. */
  items: ItemSales[];
  refunds: RefundLine[];
}

/**
 * Sums a day's paid orders. A cancelled line is refunded the way its order was
 * paid, so it counts against that payment method, on the day the order was paid.
 */
export function dailyReport(orders: Order[], voids: LineVoid[]): DailyReport {
  const voidById = new Map(voids.map((lineVoid) => [lineVoid.id, lineVoid]));
  const empty = (): PaymentSummary => ({ orders: 0, received: 0, refunded: 0 });
  const byPayment: Record<PaymentMethod, PaymentSummary> = { CASH: empty(), CARD: empty() };
  const items = new Map<string, ItemSales>();
  const refunds: RefundLine[] = [];
  const takeout = { orders: 0, received: 0 };

  for (const order of orders) {
    if (order.status !== 'PAID' || !order.paymentMethod) continue;
    const payment = byPayment[order.paymentMethod];
    payment.orders += 1;
    payment.received += order.total;
    if (isTakeout(order)) {
      takeout.orders += 1;
      takeout.received += order.total;
    }
    for (const line of order.lines) {
      const amount = lineAmount(line);
      const key = `${line.menuItemId}\u0000${line.name}`;
      const sales = items.get(key) ?? {
        menuItemId: line.menuItemId,
        name: line.name,
        quantity: 0,
        amount: 0,
        voidedQuantity: 0,
      };
      const lineVoid = voidById.get(voidId(ticketIdForOrder(order.id), line.id));
      if (lineVoid) {
        sales.voidedQuantity += line.quantity;
        payment.refunded += amount;
        refunds.push({
          voidedAt: lineVoid.voidedAt,
          tableName: order.pickupNumber != null ? pickupLabel(order.pickupNumber) : order.tableName,
          name: line.name,
          quantity: line.quantity,
          amount,
          reason: lineVoid.reason,
          paymentMethod: order.paymentMethod,
        });
      } else {
        sales.quantity += line.quantity;
        sales.amount += amount;
      }
      items.set(key, sales);
    }
  }

  const methods = Object.values(byPayment);
  return {
    orders: methods.reduce((sum, method) => sum + method.orders, 0),
    received: methods.reduce((sum, method) => sum + method.received, 0),
    refunded: methods.reduce((sum, method) => sum + method.refunded, 0),
    takeout,
    byPayment,
    items: [...items.values()].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity),
    refunds: refunds.sort((a, b) => a.voidedAt.localeCompare(b.voidedAt)),
  };
}
