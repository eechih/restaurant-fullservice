import {
  applyCatalogChange,
  applyChange,
  assignStations,
  balanceOf,
  billedLine,
  businessDate,
  can,
  closeCheckRecord,
  effectiveOrderStatus,
  emptyLiveState,
  isReason,
  lineAmount,
  MAX_PENDING_ORDERS_PER_TABLE,
  newCheck,
  newWaitlistEntry,
  ORDER_LIFETIME_MS,
  paymentAmount,
  pendingOrders,
  priceOrder,
  RejectedError,
  ROLE_LABEL,
  ROLES,
  roundStatus,
  splitIntoTickets,
  stampAfter,
  voidableLine,
  voidId,
  withPayment,
  withRound,
  type Catalog,
  type GuestCheck,
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

const emptyCatalog = (): Catalog => ({ tables: [], categories: [], items: [], stations: [] });

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
  const sendRound = (catalog: Catalog, check: GuestCheck, orderId: string, lines: Order['lines'], total: number) => {
    const now = stampAfter(check.updatedAt);
    const next = withRound(check, total, now);
    const tickets = splitIntoTickets({
      orderId,
      checkId: check.id,
      tableName: check.tableName,
      round: next.rounds,
      lines: assignStations(lines, catalog),
      sentAt: now,
    });
    return { now, check: next, tickets };
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
      const check = newCheck({ id: checkId, tableId, tableName: table.name, guestCount, partyName: entry?.name, now });
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
      const seating = { tableId: check.tableId, checkId };
      if (check.status === 'CANCELLED') return { checks: [check], clearedSeatings: [seating] };
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      if (check.rounds > 0) throw new RejectedError('CHECK_HAS_ORDERS');
      const now = stampAfter(check.updatedAt);
      return commit({
        checks: [{ ...check, status: 'CANCELLED', closedAt: now, updatedAt: now }],
        clearedSeatings: [seating],
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
      const round = sendRound(catalog, check, orderId, lines, total);
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
      const round = sendRound(catalog, check, order.id, order.lines, order.total);
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
      const ticket = read().live.tickets[ticketId];
      if (!ticket) throw new RejectedError('TICKET_NOT_FOUND');
      return commit({ tickets: [{ ...ticket, status, updatedAt: stampAfter(ticket.updatedAt) }] });
    },

    async serveTickets(ticketIds) {
      allow('serve');
      const { live } = read();
      const tickets = [...new Set(ticketIds)].map((id) => live.tickets[id]);
      if (tickets.length === 0 || tickets.some((ticket) => !ticket)) throw new RejectedError('TICKET_NOT_FOUND');
      return commit({
        tickets: tickets.map((ticket) => ({ ...ticket, status: 'SERVED', updatedAt: stampAfter(ticket.updatedAt) })),
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
      const line = voidableLine(check, ticket, lineId, existing);
      const { name, roles } = actor();
      const approver = can(roles, 'approveVoid');
      const now = stampAfter(check.updatedAt, existing?.updatedAt);
      return commit({
        voids: [
          {
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
          },
        ],
        checks: approver ? [{ ...check, billTotal: check.billTotal - lineAmount(line), updatedAt: now }] : [],
      });
    },

    async decideVoid(id, approve) {
      allow('approveVoid');
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
      return commit({
        voids: [{ ...decided, status: 'APPROVED' }],
        checks: [{ ...check, billTotal: check.billTotal - lineAmount(line), updatedAt: now }],
      });
    },

    async requestBill(checkId) {
      allow('order');
      const check = requireCheck(read().live, checkId);
      if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
      if (check.billRequestedAt) return { checks: [check] };
      const now = stampAfter(check.updatedAt);
      return commit({ checks: [{ ...check, billRequestedAt: now, updatedAt: now }] });
    },

    async recordPayment({ paymentId, checkId, method, expectedAmount, ...request }) {
      allow('checkout');
      const { live } = read();
      const existing = live.payments[paymentId];
      if (existing) return { payments: [existing], checks: [live.checks[existing.checkId]] };
      const check = requireCheck(live, checkId);
      const { amount, lineKeys } = paymentAmount(check, request, (key) => billedLine(live, check.id, key)?.amount);
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

    async cancelWaitlistEntry(id) {
      allow('waitlist');
      const entry = read().live.waitlist[id];
      if (!entry || entry.status === 'SEATED') throw new RejectedError('WAITLIST_DECIDED');
      if (entry.status === 'CANCELLED') return { waitlist: [entry] };
      return commit({ waitlist: [{ ...entry, status: 'CANCELLED', updatedAt: stampAfter(entry.updatedAt) }] });
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
      const { categories, items } = read().catalog;
      return { categories, items };
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
      const { lines, total } = priceOrder(catalog.items, items, () => crypto.randomUUID());
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
