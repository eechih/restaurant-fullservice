import {
  applyCatalogChange,
  applyChange,
  balanceOf,
  billOf,
  businessDate,
  can,
  checkInvoice,
  closeCheckRecord,
  courseAfterSending,
  decidedDiscounts,
  firedCourse,
  defaultSettings,
  effectiveOrderStatus,
  emptyLiveState,
  isReason,
  mergedChecks,
  rearrangeable,
  MAX_PENDING_ORDERS_PER_TABLE,
  newCheck,
  newDiscount,
  newWaitlistEntry,
  noInvoiceDetails,
  ORDER_LIFETIME_MS,
  paymentAmount,
  pendingOrders,
  prepareLines,
  priceOrder,
  RejectedError,
  ROLE_LABEL,
  ROLES,
  roundStatus,
  splitIntoTickets,
  stampAfter,
  tablesOf,
  ticketsForCheck,
  voidableLine,
  voidId,
  withBill,
  withoutDiscount,
  withPayment,
  withRound,
  withTables,
  withTicketStatus,
  type Catalog,
  type GuestCheck,
  type KitchenTicket,
  type LineVoid,
  type LiveChange,
  type LiveState,
  type Order,
  type OrderItemInput,
  type Payment,
  type Permission,
  type Role,
} from '../domain';
import type { CustomerOrder, CustomerRepository } from './customerRepository';
import type { Repository } from './repository';
import { sampleCatalog } from './sampleCatalog';

const STORAGE_KEY = 'fullservice-demo-v1';
const CHANNEL = 'fullservice-demo';

interface DemoData {
  catalog: Catalog;
  live: LiveState;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Who is using a demo screen. Demo mode has no accounts, so each tab picks its roles. */
export interface DemoActor {
  name: string;
  roles: Role[];
}
export const everyRole: DemoActor = { name: '展示帳號', roles: [...ROLES] };
export const demoActor = (roles: Role[]): DemoActor => ({
  name: `展示（${roles.map((role) => ROLE_LABEL[role]).join('、')}）`,
  roles,
});

const emptyCatalog = (): Catalog => ({ tables: [], categories: [], items: [], stations: [], settings: defaultSettings });

/** Tickets still to be served, renamed after the party's tables, so the food reaches them. */
const relabelled = (live: LiveState, check: GuestCheck) =>
  ticketsForCheck(live, check.id)
    .filter((ticket) => ticket.status !== 'SERVED' && ticket.tableName !== check.tableName)
    .map((ticket) => ({ ...ticket, tableName: check.tableName, updatedAt: stampAfter(ticket.updatedAt) }));

/** The check with its totals worked out again, as the server does after every change to what is billed. */
function rebilled(
  live: LiveState,
  check: GuestCheck,
  now: string,
  change: { sent?: KitchenTicket[]; voided?: LineVoid } = {},
) {
  const tickets = [...ticketsForCheck(live, check.id), ...(change.sent ?? [])];
  const voids = change.voided ? { ...live.voids, [change.voided.id]: change.voided } : live.voids;
  return withBill(check, billOf(check, tickets, voids), now);
}

function createStore(storage: KeyValueStore) {
  const read = (): DemoData => {
    const raw = storage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<DemoData>) : {};
    return {
      catalog: { ...emptyCatalog(), ...data.catalog },
      live: { ...emptyLiveState, ...data.live },
    };
  };
  const write = (data: DemoData) => storage.setItem(STORAGE_KEY, JSON.stringify(data));
  /** Saves a change and tells the other tabs, as the server's notification would. */
  const commit = (change: LiveChange) => {
    const data = read();
    write({ ...data, live: applyChange(data.live, change) });
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(change);
    channel.close();
    return change;
  };
  return { read, write, commit };
}

/**
 * Keeps data in browser storage and syncs tabs on this device. It applies the
 * same rules as the server, so that the demo behaves the same.
 */
export function createDemoRepository(
  storage: KeyValueStore = localStorage,
  actor: () => DemoActor = () => everyRole,
): Repository {
  const { read, write, commit } = createStore(storage);
  const allow = (permission: Permission) => {
    if (!can(actor().roles, permission)) throw new RejectedError('FORBIDDEN');
  };
  const requireCheck = (live: LiveState, checkId: string) => {
    const check = live.checks[checkId];
    if (!check) throw new RejectedError('TABLE_NOT_OPEN');
    return check;
  };

  /** Puts a round on the check and splits it into tickets. */
  const sendRound = (catalog: Catalog, live: LiveState, check: GuestCheck, orderId: string, lines: Order['lines']) => {
    const now = stampAfter(check.updatedAt);
    const prepared = prepareLines(lines, catalog);
    const course = courseAfterSending(check, prepared);
    const tickets = splitIntoTickets({
      orderId,
      checkId: check.id,
      tableName: check.tableName,
      round: check.rounds + 1,
      lines: prepared,
      sentAt: now,
      firedCourse: course,
    });
    return { now, check: rebilled(live, withRound(check, tickets, now, course), now, { sent: tickets }), tickets };
  };

  return {
    mode: 'demo',

    async getCatalog() {
      return read().catalog;
    },
    async seedCatalog() {
      allow('settings');
      write({
        ...read(),
        catalog: {
          ...sampleCatalog,
          tables: sampleCatalog.tables.map((table) => ({ ...table, qrToken: crypto.randomUUID() })),
        },
      });
    },
    async changeCatalog(changes) {
      allow('settings');
      const data = read();
      write({ ...data, catalog: changes.reduce(applyCatalogChange, data.catalog) });
    },
    async setItemAvailable(itemId, available) {
      allow('availability');
      const data = read();
      write({
        ...data,
        catalog: {
          ...data.catalog,
          items: data.catalog.items.map((item) => (item.id === itemId ? { ...item, available } : item)),
        },
      });
    },
    async rotateTableToken(tableId) {
      allow('settings');
      const data = read();
      write({
        ...data,
        catalog: {
          ...data.catalog,
          tables: data.catalog.tables.map((table) =>
            table.id === tableId ? { ...table, qrToken: crypto.randomUUID() } : table,
          ),
        },
      });
    },

    async loadLiveState() {
      return read().live;
    },
    subscribe({ onChange, onConnection }) {
      const channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (message: MessageEvent<LiveChange>) => onChange(message.data);
      onConnection(true);
      return () => channel.close();
    },

    async openTable({ checkId, tableId, guestCount, waitlistEntryId }) {
      allow('openTable');
      const { catalog, live } = read();
      const seating = live.seatings[tableId];
      if (seating) {
        if (seating.checkId !== checkId) throw new RejectedError('TABLE_OCCUPIED');
        return { seatings: [seating], checks: [live.checks[checkId]].filter(Boolean) };
      }
      const table = catalog.tables.find((candidate) => candidate.id === tableId);
      if (!table) throw new RejectedError('TABLE_NOT_FOUND');
      const entry = waitlistEntryId ? live.waitlist[waitlistEntryId] : undefined;
      if (waitlistEntryId && entry?.status !== 'WAITING') throw new RejectedError('WAITLIST_DECIDED');
      const now = stampAfter();
      const check = newCheck({
        id: checkId,
        tableId,
        tableName: table.name,
        guestCount,
        partyName: entry?.name,
        serviceChargeRate: catalog.settings.serviceChargeRate,
        now,
      });
      return commit({
        seatings: [{ tableId, checkId }],
        checks: [check],
        waitlist: entry
          ? [{ ...entry, status: 'SEATED', seatedAt: now, tableId, updatedAt: stampAfter(entry.updatedAt) }]
          : [],
      });
    },

    async cancelTable(checkId) {
      allow('openTable');
      const check = requireCheck(read().live, checkId);
      const seatings = tablesOf(check).map((tableId) => ({ tableId, checkId }));
      if (check.status === 'CANCELLED') return { checks: [check], clearedSeatings: seatings };
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      if (check.rounds > 0) throw new RejectedError('CHECK_HAS_ORDERS');
      const now = stampAfter(check.updatedAt);
      return commit({
        checks: [{ ...check, status: 'CANCELLED', closedAt: now, updatedAt: now }],
        clearedSeatings: seatings,
      });
    },

    async moveTable(checkId, fromTableId, toTableId) {
      allow('tables');
      const { catalog, live } = read();
      const check = requireCheck(live, checkId);
      const tables = tablesOf(check);
      if (!tables.includes(fromTableId) && tables.includes(toTableId)) return { checks: [check] };
      if (!tables.includes(fromTableId)) throw new RejectedError('TABLE_NOT_OPEN');
      if (!catalog.tables.some((table) => table.id === toTableId)) throw new RejectedError('TABLE_NOT_FOUND');
      rearrangeable(check, Boolean(live.seatings[toTableId]));
      const now = stampAfter(check.updatedAt);
      const next = withTables(check, [...tables.filter((id) => id !== fromTableId), toTableId], catalog.tables, now);
      return commit({
        seatings: [{ tableId: toTableId, checkId }],
        clearedSeatings: [{ tableId: fromTableId, checkId }],
        checks: [next],
        tickets: relabelled(live, next),
      });
    },

    async addTable(checkId, tableId) {
      allow('tables');
      const { catalog, live } = read();
      const check = requireCheck(live, checkId);
      if (tablesOf(check).includes(tableId)) return { checks: [check] };
      if (!catalog.tables.some((table) => table.id === tableId)) throw new RejectedError('TABLE_NOT_FOUND');
      rearrangeable(check, Boolean(live.seatings[tableId]));
      const now = stampAfter(check.updatedAt);
      const next = withTables(check, [...tablesOf(check), tableId], catalog.tables, now);
      return commit({ seatings: [{ tableId, checkId }], checks: [next], tickets: relabelled(live, next) });
    },

    async mergeChecks(fromCheckId, intoCheckId) {
      allow('tables');
      const { catalog, live } = read();
      const from = requireCheck(live, fromCheckId);
      const into = requireCheck(live, intoCheckId);
      if (from.status === 'MERGED' && from.mergedInto === into.id) return { checks: [from, into] };
      const now = stampAfter(from.updatedAt, into.updatedAt);
      const merged = mergedChecks(from, into, now);
      const combined = withTables(merged.into, tablesOf(merged.into), catalog.tables, now);
      const tickets = [...ticketsForCheck(live, into.id), ...ticketsForCheck(live, from.id)].map((ticket) => ({
        ...ticket,
        checkId: into.id,
        tableName: ticket.status === 'SERVED' ? ticket.tableName : combined.tableName,
        updatedAt: stampAfter(ticket.updatedAt),
      }));
      const voids = Object.values(live.voids)
        .filter((lineVoid) => lineVoid.checkId === from.id)
        .map((lineVoid) => ({ ...lineVoid, checkId: into.id, updatedAt: stampAfter(lineVoid.updatedAt) }));
      const voidRecords = { ...live.voids, ...Object.fromEntries(voids.map((lineVoid) => [lineVoid.id, lineVoid])) };
      return commit({
        checks: [merged.from, withBill(combined, billOf(combined, tickets, voidRecords), now)],
        seatings: tablesOf(from).map((tableId) => ({ tableId, checkId: into.id })),
        tickets,
        voids,
      });
    },

    async sendOrder({ orderId, checkId, items, expectedTotal }) {
      allow('order');
      const { catalog, live } = read();
      const sent = Object.values(live.tickets).filter((ticket) => ticket.orderId === orderId);
      if (sent.length > 0) return { tickets: sent, checks: [live.checks[sent[0].checkId]] };
      const check = requireCheck(live, checkId);
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      const { lines, total } = priceOrder(catalog.items, items, () => crypto.randomUUID());
      if (total !== expectedTotal) throw new RejectedError('PRICE_CHANGED');
      const round = sendRound(catalog, live, check, orderId, lines);
      return commit({ checks: [round.check], tickets: round.tickets });
    },

    async confirmCustomerOrder(orderId) {
      allow('order');
      const { catalog, live } = read();
      const order = live.orders[orderId];
      if (!order) throw new RejectedError('ORDER_NOT_FOUND');
      if (order.status === 'SENT') {
        return {
          orders: [order],
          tickets: order.ticketIds.map((id) => live.tickets[id]),
          checks: [live.checks[order.checkId ?? '']].filter(Boolean),
        };
      }
      if (order.status === 'REJECTED') throw new RejectedError('ORDER_DECIDED');
      if (effectiveOrderStatus(order, Date.now()) === 'EXPIRED') throw new RejectedError('ORDER_EXPIRED');
      const check = live.checks[live.seatings[order.tableId]?.checkId];
      if (!check || check.status !== 'OPEN') throw new RejectedError('TABLE_NOT_OPEN');
      const round = sendRound(catalog, live, check, order.id, order.lines);
      const now = stampAfter(round.now, order.updatedAt);
      return commit({
        orders: [
          {
            ...order,
            checkId: check.id,
            status: 'SENT',
            lines: round.tickets.flatMap((ticket) => ticket.lines),
            round: round.check.rounds,
            ticketIds: round.tickets.map((ticket) => ticket.id),
            decidedAt: now,
            updatedAt: now,
          },
        ],
        tickets: round.tickets,
        checks: [round.check],
      });
    },

    async rejectCustomerOrder(orderId) {
      allow('order');
      const order = read().live.orders[orderId];
      if (!order) throw new RejectedError('ORDER_NOT_FOUND');
      if (order.status === 'REJECTED') return { orders: [order] };
      if (order.status !== 'PENDING') throw new RejectedError('ORDER_DECIDED');
      const now = stampAfter(order.updatedAt);
      return commit({ orders: [{ ...order, status: 'REJECTED', decidedAt: now, updatedAt: now }] });
    },

    async setTicketStatus(ticketId, status) {
      allow('cook');
      // Only firing a course moves a ticket out of HELD, and nothing moves one back.
      if (status === 'HELD') throw new RejectedError('FORBIDDEN');
      const ticket = read().live.tickets[ticketId];
      if (!ticket) throw new RejectedError('TICKET_NOT_FOUND');
      return commit({ tickets: [withTicketStatus(ticket, status, stampAfter(ticket.updatedAt))] });
    },

    async serveTickets(ticketIds) {
      allow('serve');
      const { live } = read();
      const tickets = [...new Set(ticketIds)].map((id) => live.tickets[id]);
      if (tickets.length === 0 || tickets.some((ticket) => !ticket)) throw new RejectedError('TICKET_NOT_FOUND');
      return commit({
        tickets: tickets.map((ticket) => withTicketStatus(ticket, 'SERVED', stampAfter(ticket.updatedAt))),
      });
    },

    async requestVoid({ ticketId, lineId, reason }) {
      allow('order');
      const trimmed = reason.trim();
      if (!isReason(trimmed)) throw new RejectedError('INVALID_REASON');
      const { live } = read();
      const ticket = live.tickets[ticketId];
      const check = ticket && live.checks[ticket.checkId];
      const id = voidId(ticketId, lineId);
      const existing = live.voids[id];
      voidableLine(check, ticket, lineId, existing);
      const { name, roles } = actor();
      const approver = can(roles, 'approve');
      const now = stampAfter(check.updatedAt, existing?.updatedAt);
      const lineVoid: LineVoid = {
        id,
        ticketId,
        checkId: check.id,
        lineId,
        reason: trimmed,
        status: approver ? 'APPROVED' : 'REQUESTED',
        requestedBy: name,
        requestedAt: now,
        decidedBy: approver ? name : null,
        decidedAt: approver ? now : null,
        updatedAt: now,
      };
      return commit({
        voids: [lineVoid],
        checks: approver ? [rebilled(live, check, now, { voided: lineVoid })] : [],
      });
    },

    async decideVoid(id, approve) {
      allow('approve');
      const { live } = read();
      const lineVoid = live.voids[id];
      if (!lineVoid) throw new RejectedError('LINE_NOT_FOUND');
      if (lineVoid.status === (approve ? 'APPROVED' : 'REJECTED')) return { voids: [lineVoid] };
      if (lineVoid.status !== 'REQUESTED') throw new RejectedError('VOID_DECIDED');
      const check = live.checks[lineVoid.checkId];
      const line = live.tickets[lineVoid.ticketId]?.lines.find((candidate) => candidate.id === lineVoid.lineId);
      const now = stampAfter(lineVoid.updatedAt, check?.updatedAt);
      const decided = { ...lineVoid, decidedBy: actor().name, decidedAt: now, updatedAt: now };
      if (!approve) return commit({ voids: [{ ...decided, status: 'REJECTED' }] });
      if (!check || !line) throw new RejectedError('LINE_NOT_FOUND');
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      if (check.paidTotal > 0) throw new RejectedError('CHECK_PAYING');
      const approved: LineVoid = { ...decided, status: 'APPROVED' };
      return commit({ voids: [approved], checks: [rebilled(live, check, now, { voided: approved })] });
    },

    async requestDiscount(checkId, request) {
      allow('discount');
      const { live } = read();
      const check = requireCheck(live, checkId);
      if (check.discounts.some((discount) => discount.id === request.id)) return { checks: [check] };
      const { name, roles } = actor();
      const now = stampAfter(check.updatedAt);
      const bill = billOf(check, ticketsForCheck(live, check.id), live.voids);
      const discount = newDiscount(check, bill, request, { name, approver: can(roles, 'approve') }, now);
      const next: GuestCheck = { ...check, discounts: [...check.discounts, discount], updatedAt: now };
      return commit({ checks: [discount.status === 'APPROVED' ? rebilled(live, next, now) : next] });
    },

    async decideDiscount(checkId, discountId, approve) {
      allow('approve');
      const { live } = read();
      const check = requireCheck(live, checkId);
      const current = check.discounts.find((discount) => discount.id === discountId);
      if (current?.status === (approve ? 'APPROVED' : 'REJECTED')) return { checks: [check] };
      const now = stampAfter(check.updatedAt);
      const next: GuestCheck = {
        ...check,
        discounts: decidedDiscounts(check, discountId, approve, actor().name, now),
        updatedAt: now,
      };
      return commit({ checks: [approve ? rebilled(live, next, now) : next] });
    },

    async removeDiscount(checkId, discountId) {
      allow('approve');
      const { live } = read();
      const check = requireCheck(live, checkId);
      if (!check.discounts.some((discount) => discount.id === discountId)) return { checks: [check] };
      const now = stampAfter(check.updatedAt);
      return commit({
        checks: [rebilled(live, { ...check, discounts: withoutDiscount(check, discountId), updatedAt: now }, now)],
      });
    },

    async fireCourse(checkId, course) {
      allow('order');
      const { live } = read();
      const check = requireCheck(live, checkId);
      const fired = firedCourse(check, ticketsForCheck(live, checkId), course, stampAfter(check.updatedAt));
      return commit({ checks: [fired.check], tickets: fired.tickets });
    },

    async requestBill(checkId) {
      allow('order');
      const check = requireCheck(read().live, checkId);
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      if (check.billRequestedAt) return { checks: [check] };
      const now = stampAfter(check.updatedAt);
      return commit({ checks: [{ ...check, billRequestedAt: now, updatedAt: now }] });
    },

    async recordPayment({ paymentId, checkId, method, expectedAmount, invoice, ...request }) {
      allow('checkout');
      const { live } = read();
      const existing = live.payments[paymentId];
      if (existing) return { payments: [existing], checks: [live.checks[existing.checkId]] };
      const check = requireCheck(live, checkId);
      const details = checkInvoice(invoice ?? noInvoiceDetails);
      const { amount, lineKeys } = paymentAmount(check, request, billOf(check, ticketsForCheck(live, check.id), live.voids));
      if (amount !== expectedAmount) throw new RejectedError('AMOUNT_CHANGED');
      const now = stampAfter(check.updatedAt);
      const payment: Payment = {
        id: paymentId,
        checkId,
        tableName: check.tableName,
        method,
        kind: request.kind,
        amount,
        parts: request.kind === 'SHARE' ? request.parts : null,
        lineKeys,
        paidAt: now,
        businessDate: businessDate(now),
        invoice: details,
        invoiceNumber: null,
      };
      return commit({ payments: [payment], checks: [withPayment(check, payment, now)] });
    },

    async closeCheck(checkId) {
      allow('checkout');
      const check = requireCheck(read().live, checkId);
      if (check.status === 'CLOSED') return { checks: [check] };
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      if (check.rounds === 0) throw new RejectedError('NOTHING_TO_PAY');
      if (balanceOf(check) > 0) throw new RejectedError('BALANCE_DUE');
      return commit({ checks: [closeCheckRecord(check, stampAfter(check.updatedAt))] });
    },

    async markTableCleaned(tableId) {
      allow('clearTable');
      const { live } = read();
      const seating = live.seatings[tableId];
      if (!seating) return {};
      if (live.checks[seating.checkId]?.status === 'OPEN') throw new RejectedError('TABLE_NOT_CLEARABLE');
      return commit({ clearedSeatings: [seating] });
    },

    async addToWaitlist(input) {
      allow('waitlist');
      const existing = read().live.waitlist[input.id];
      if (existing) return { waitlist: [existing] };
      return commit({ waitlist: [newWaitlistEntry(input, stampAfter())] });
    },

    async cancelWaitlistEntry(id, noShow = false) {
      allow('waitlist');
      const entry = read().live.waitlist[id];
      if (!entry || entry.status === 'SEATED') throw new RejectedError('WAITLIST_DECIDED');
      if (entry.status !== 'WAITING') return { waitlist: [entry] };
      const status = noShow ? 'NO_SHOW' : 'CANCELLED';
      return commit({ waitlist: [{ ...entry, status, updatedAt: stampAfter(entry.updatedAt) }] });
    },

    async getDailyRecords(date) {
      allow('report');
      const { live } = read();
      const checks = Object.values(live.checks).filter((check) => check.closedDate === date);
      const ids = new Set(checks.map((check) => check.id));
      return {
        payments: Object.values(live.payments).filter((payment) => payment.businessDate === date),
        checks,
        tickets: Object.values(live.tickets).filter((ticket) => ids.has(ticket.checkId)),
        voids: Object.values(live.voids).filter((lineVoid) => ids.has(lineVoid.checkId)),
      };
    },

    resetDemo() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

/** The customer side of demo mode. It cannot show the real trust boundary. */
export function createDemoCustomerRepository(storage: KeyValueStore = localStorage): CustomerRepository {
  const { read, commit } = createStore(storage);

  const toCustomerOrder = (order: Order): CustomerOrder => {
    const { live } = read();
    const tickets = order.ticketIds.flatMap((id) => live.tickets[id] ?? []);
    const kitchen = tickets.length > 0 ? roundStatus(live, tickets) : undefined;
    return {
      id: order.id,
      tableId: order.tableId,
      tableName: order.tableName,
      status: effectiveOrderStatus(order, Date.now()),
      lines: order.lines,
      total: order.total,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      kitchenStatus: kitchen === 'VOIDED' ? null : kitchen,
      voidedLineIds: tickets.flatMap((ticket) =>
        ticket.lines
          .filter((line) => live.voids[voidId(ticket.id, line.id)]?.status === 'APPROVED')
          .map((line) => line.id),
      ),
    };
  };

  const tableFor = (tableToken: string) =>
    read().catalog.tables.find((candidate) => candidate.qrToken === tableToken);

  return {
    async getTable(tableToken) {
      const table = tableFor(tableToken);
      return table ? { name: table.name } : null;
    },
    async getMenu() {
      const { categories, items, settings } = read().catalog;
      return { categories, items, serviceChargeRate: settings.serviceChargeRate };
    },
    async placeOrder({ orderId, tableToken, items, expectedTotal }: {
      orderId: string;
      tableToken: string;
      items: OrderItemInput[];
      expectedTotal: number;
    }) {
      const { catalog, live } = read();
      const existing = live.orders[orderId];
      if (existing) return toCustomerOrder(existing);
      const table = tableFor(tableToken);
      if (!table) throw new RejectedError('TABLE_NOT_FOUND');
      const waiting = pendingOrders(live, Date.now()).filter((order) => order.tableId === table.id);
      if (waiting.length >= MAX_PENDING_ORDERS_PER_TABLE) throw new RejectedError('TOO_MANY_PENDING');
      // Customers do not choose courses.
      const asked = items.map((input) => ({ ...input, course: undefined }));
      const { lines, total } = priceOrder(catalog.items, asked, () => crypto.randomUUID());
      if (total !== expectedTotal) throw new RejectedError('PRICE_CHANGED');
      const now = Date.now();
      const createdAt = new Date(now).toISOString();
      const order: Order = {
        id: orderId,
        source: 'CUSTOMER',
        tableId: table.id,
        tableName: table.name,
        status: 'PENDING',
        lines,
        total,
        createdAt,
        expiresAt: new Date(now + ORDER_LIFETIME_MS).toISOString(),
        ticketIds: [],
        updatedAt: createdAt,
      };
      commit({ orders: [order] });
      return toCustomerOrder(order);
    },
    async getOrder(orderId) {
      const order = read().live.orders[orderId];
      return order ? toCustomerOrder(order) : null;
    },
  };
}
