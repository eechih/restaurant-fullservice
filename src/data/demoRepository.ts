import {
  applyCatalogChange,
  applyEvent,
  businessDate,
  isTakeout,
  pendingLimitFor,
  pickupLabel,
  TAKEOUT_TABLE_ID,
  ConflictError,
  effectiveOrderStatus,
  emptyLiveState,
  nextRound,
  ORDER_LIFETIME_MS,
  OrderRejectedError,
  pendingOrders,
  priceOrder,
  ticketIdForOrder,
  voidId,
  type Catalog,
  type GuestCheck,
  type LiveEvent,
  type LiveState,
  type Order,
  type OrderItemInput,
} from '../domain';
import type { CustomerOrder, CustomerRepository } from './customerRepository';
import type { Repository } from './repository';
import { sampleCatalog } from './sampleCatalog';

const STORAGE_KEY = 'pos-kds-demo-v2';
const CHANNEL = 'pos-kds-demo';

interface DemoData {
  catalog: Catalog;
  live: LiveState;
  /** Last pickup number given, by business date. */
  pickupCounters?: Record<string, number>;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function createStore(storage: KeyValueStore) {
  const read = (): DemoData => {
    const raw = storage.getItem(STORAGE_KEY);
    return raw
      ? (JSON.parse(raw) as DemoData)
      : { catalog: { tables: [], categories: [], items: [] }, live: emptyLiveState };
  };
  const write = (data: DemoData) => storage.setItem(STORAGE_KEY, JSON.stringify(data));
  const apply = (event: LiveEvent) => {
    const data = read();
    write({ ...data, live: applyEvent(data.live, event) });
  };
  const commit = (event: LiveEvent) => {
    apply(event);
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(event);
    channel.close();
  };

  /** Stands in for the server's pricing and retry handling. */
  const placeOrder = (
    orderId: string,
    table: { id: string; name: string } | undefined,
    items: OrderItemInput[],
    expectedTotal: number,
    { limitPending }: { limitPending: boolean },
  ): Order => {
    const { catalog, live } = read();
    const existing = live.orders[orderId];
    if (existing) return existing;
    if (!table) throw new OrderRejectedError('TABLE_NOT_FOUND');
    if (
      limitPending &&
      pendingOrders(live, Date.now()).filter((order) => order.tableId === table.id).length >=
        pendingLimitFor(table.id)
    ) {
      throw new OrderRejectedError('TOO_MANY_PENDING');
    }
    const { lines, total } = priceOrder(catalog.items, items, () => crypto.randomUUID());
    if (total !== expectedTotal) throw new OrderRejectedError('PRICE_CHANGED');
    const now = Date.now();
    const order: Order = {
      id: orderId,
      tableId: table.id,
      tableName: table.name,
      status: 'PENDING',
      lines,
      total,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ORDER_LIFETIME_MS).toISOString(),
    };
    // Like the real backend, only customer orders notify other screens.
    (limitPending ? commit : apply)({ type: 'order/upsert', order });
    return order;
  };

  return { read, write, commit, placeOrder };
}

/** Keeps data in browser storage and syncs tabs on this device. */
export function createDemoRepository(storage: KeyValueStore = localStorage): Repository {
  const { read, write, commit, placeOrder } = createStore(storage);

  return {
    mode: 'demo',
    async getCatalog() {
      return read().catalog;
    },
    async seedCatalog() {
      write({
        ...read(),
        catalog: {
          ...sampleCatalog,
          tables: sampleCatalog.tables.map((table) => ({
            ...table,
            qrToken: crypto.randomUUID(),
          })),
        },
      });
    },
    async changeCatalog(changes) {
      const data = read();
      write({ ...data, catalog: changes.reduce(applyCatalogChange, data.catalog) });
    },
    async setItemAvailable(itemId, available) {
      const data = read();
      write({
        ...data,
        catalog: {
          ...data.catalog,
          items: data.catalog.items.map((item) =>
            item.id === itemId ? { ...item, available } : item,
          ),
        },
      });
    },
    async rotateTableToken(tableId) {
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
    subscribe({ onEvent, onConnection }) {
      const channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (message: MessageEvent<LiveEvent>) => onEvent(message.data);
      onConnection(true);
      return () => channel.close();
    },
    async openTable({ tableId, tableName, guestCount }) {
      if (read().live.seatings[tableId]) throw new ConflictError('table already occupied');
      const check: GuestCheck = {
        id: crypto.randomUUID(),
        tableId,
        tableName,
        guestCount,
        openedAt: new Date().toISOString(),
      };
      commit({ type: 'check/upsert', check });
      commit({ type: 'seating/upsert', seating: { tableId, checkId: check.id } });
      return check;
    },
    async placeStaffOrder({ orderId, tableId, items, expectedTotal }) {
      const table = read().catalog.tables.find((candidate) => candidate.id === tableId);
      placeOrder(orderId, table, items, expectedTotal, { limitPending: false });
    },
    async confirmOrderPayment(orderId, paymentMethod) {
      const { live } = read();
      const order = live.orders[orderId];
      if (!order) throw new OrderRejectedError('ORDER_NOT_FOUND');

      const now = Date.now();
      const status = effectiveOrderStatus(order, now);
      if (status === 'EXPIRED') throw new OrderRejectedError('ORDER_EXPIRED');

      const ticketId = ticketIdForOrder(orderId);
      if (status === 'PAID') {
        return [
          { type: 'order/upsert', order },
          { type: 'ticket/upsert', ticket: live.tickets[ticketId] },
        ];
      }

      const paidAt = new Date(now).toISOString();
      const takeout = isTakeout(order);
      // Takeout never occupies the counter: each order is a check of its own.
      const seating = takeout ? undefined : live.seatings[order.tableId];
      const checkId = seating?.checkId ?? crypto.randomUUID();
      let pickupNumber: number | undefined;
      if (takeout) {
        const data = read();
        const day = businessDate(now);
        pickupNumber = (data.pickupCounters?.[day] ?? 0) + 1;
        write({ ...data, pickupCounters: { ...data.pickupCounters, [day]: pickupNumber } });
      }
      const label = pickupNumber != null ? pickupLabel(pickupNumber) : order.tableName;
      const events: LiveEvent[] = [];
      if (takeout) {
        events.push({
          type: 'check/upsert',
          check: { id: checkId, tableId: order.tableId, tableName: label, openedAt: paidAt },
        });
      } else if (!seating) {
        events.push(
          {
            type: 'check/upsert',
            check: { id: checkId, tableId: order.tableId, tableName: order.tableName, openedAt: paidAt },
          },
          { type: 'seating/upsert', seating: { tableId: order.tableId, checkId } },
        );
      }
      events.push(
        { type: 'order/upsert', order: { ...order, status: 'PAID', checkId, paymentMethod, paidAt, pickupNumber } },
        {
          type: 'ticket/upsert',
          ticket: {
            id: ticketId,
            checkId,
            tableName: label,
            round: nextRound(live, checkId),
            status: 'NEW',
            sentAt: paidAt,
            lines: order.lines,
            pickupNumber,
          },
        },
      );
      events.forEach(commit);
      return events;
    },
    async setTicketStatus(ticketId, status) {
      const ticket = read().live.tickets[ticketId];
      if (!ticket) throw new Error(`unknown ticket ${ticketId}`);
      commit({ type: 'ticket/upsert', ticket: { ...ticket, status } });
    },
    async voidLine(lineVoid) {
      if (read().live.voids[lineVoid.id]) return;
      commit({ type: 'void/upsert', lineVoid });
    },
    async clearTable(tableId) {
      commit({ type: 'seating/delete', tableId });
    },
    async getDailyRecords(date) {
      const { live } = read();
      const orders = Object.values(live.orders).filter(
        (order) => order.status === 'PAID' && order.paidAt && businessDate(order.paidAt) === date,
      );
      const ids = new Set(
        orders.flatMap((order) => order.lines.map((line) => voidId(ticketIdForOrder(order.id), line.id))),
      );
      return { orders, voids: Object.values(live.voids).filter((lineVoid) => ids.has(lineVoid.id)) };
    },
    resetDemo() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

/** The customer side of demo mode. It cannot show the real trust boundary. */
export function createDemoCustomerRepository(
  storage: KeyValueStore = localStorage,
): CustomerRepository {
  const { read, placeOrder } = createStore(storage);

  const toCustomerOrder = (order: Order): CustomerOrder => ({
    id: order.id,
    tableId: order.tableId,
    tableName: order.tableName,
    status: effectiveOrderStatus(order, Date.now()),
    lines: order.lines,
    total: order.total,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    ticketStatus: read().live.tickets[ticketIdForOrder(order.id)]?.status,
    voidedLineIds: order.lines
      .filter((line) => read().live.voids[voidId(ticketIdForOrder(order.id), line.id)])
      .map((line) => line.id),
    pickupNumber: order.pickupNumber,
  });

  return {
    async getTable(tableToken) {
      const table = read().catalog.tables.find((candidate) => candidate.qrToken === tableToken);
      return table ? { name: table.name, takeout: table.id === TAKEOUT_TABLE_ID } : null;
    },
    async getMenu() {
      const { categories, items } = read().catalog;
      return { categories, items };
    },
    async placeOrder({ orderId, tableToken, items, expectedTotal }) {
      const table = read().catalog.tables.find((candidate) => candidate.qrToken === tableToken);
      return toCustomerOrder(placeOrder(orderId, table, items, expectedTotal, { limitPending: true }));
    },
    async getOrder(orderId) {
      const order = read().live.orders[orderId];
      return order ? toCustomerOrder(order) : null;
    },
  };
}
