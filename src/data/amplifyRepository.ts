import { CONNECTION_STATE_CHANGE, ConnectionState } from 'aws-amplify/api';
import { generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import type { Schema } from '../../amplify/data/resource';
import {
  ConflictError,
  defaultSettings,
  type Catalog,
  type CatalogChange,
  type GuestCheck,
  type KitchenTicket,
  type LineVoid,
  type LiveChange,
  type LiveState,
  type Order,
  type Payment,
  type Seating,
  type TicketStatus,
  type WaitlistEntry,
} from '../domain';
import { listAll, type ModelResult, toCategories, toMenuItems, unwrap } from './amplifyHelpers';
import type { LiveOperations, Repository, StaffDirectory } from './repository';
import { sampleCatalog } from './sampleCatalog';

const ignoreConflict = (error: unknown) => {
  if (!(error instanceof ConflictError)) throw error;
};

// Models and the function's records have the same fields, so one mapping serves both.

const toSeating = (raw: Schema['SeatingRecord']['type']): Seating => ({ tableId: raw.tableId, checkId: raw.checkId });

const toCheck = (raw: Schema['CheckRecord']['type']): GuestCheck => ({
  id: raw.id,
  tableId: raw.tableId,
  tableIds: raw.tableIds,
  tableName: raw.tableName,
  mergedInto: raw.mergedInto,
  guestCount: raw.guestCount,
  partyName: raw.partyName,
  status: raw.status,
  openedAt: raw.openedAt,
  rounds: raw.rounds,
  firedCourse: raw.firedCourse,
  ticketIds: raw.ticketIds,
  discounts: raw.discounts,
  serviceChargeRate: raw.serviceChargeRate,
  itemsTotal: raw.itemsTotal,
  discountTotal: raw.discountTotal,
  serviceCharge: raw.serviceCharge,
  billTotal: raw.billTotal,
  paidTotal: raw.paidTotal,
  paidLineKeys: raw.paidLineKeys,
  billRequestedAt: raw.billRequestedAt,
  closedAt: raw.closedAt,
  closedDate: raw.closedDate,
  updatedAt: raw.updatedAt,
});

const toOrder = (raw: Schema['OrderRecord']['type']): Order => ({
  id: raw.id,
  source: raw.source,
  tableId: raw.tableId,
  tableName: raw.tableName,
  checkId: raw.checkId,
  status: raw.status,
  lines: raw.lines,
  total: raw.total,
  createdAt: raw.createdAt,
  expiresAt: raw.expiresAt,
  round: raw.round,
  ticketIds: raw.ticketIds,
  decidedAt: raw.decidedAt,
  updatedAt: raw.updatedAt,
});

const toTicket = (raw: Schema['TicketRecord']['type']): KitchenTicket => ({
  id: raw.id,
  orderId: raw.orderId,
  checkId: raw.checkId,
  tableName: raw.tableName,
  round: raw.round,
  stationId: raw.stationId,
  course: raw.course,
  status: raw.status,
  sentAt: raw.sentAt,
  startedAt: raw.startedAt,
  readyAt: raw.readyAt,
  servedAt: raw.servedAt,
  lines: raw.lines,
  updatedAt: raw.updatedAt,
});

const toVoid = (raw: Schema['VoidRecord']['type']): LineVoid => ({
  id: raw.id,
  ticketId: raw.ticketId,
  checkId: raw.checkId,
  lineId: raw.lineId,
  reason: raw.reason,
  status: raw.status,
  requestedBy: raw.requestedBy,
  requestedAt: raw.requestedAt,
  decidedBy: raw.decidedBy,
  decidedAt: raw.decidedAt,
  updatedAt: raw.updatedAt,
});

const toPayment = (raw: Schema['PaymentRecord']['type']): Payment => ({
  id: raw.id,
  checkId: raw.checkId,
  tableName: raw.tableName,
  method: raw.method,
  kind: raw.kind,
  amount: raw.amount,
  parts: raw.parts,
  lineKeys: raw.lineKeys,
  paidAt: raw.paidAt,
  businessDate: raw.businessDate,
  invoice: raw.invoice,
  invoiceNumber: raw.invoiceNumber,
});

const toEntry = (raw: Schema['WaitlistRecord']['type']): WaitlistEntry => ({
  id: raw.id,
  name: raw.name,
  partySize: raw.partySize,
  phone: raw.phone,
  reservedFor: raw.reservedFor,
  note: raw.note,
  status: raw.status,
  createdAt: raw.createdAt,
  seatedAt: raw.seatedAt,
  tableId: raw.tableId,
  updatedAt: raw.updatedAt,
});

const toChange = (raw: Schema['LiveChange']['type']): LiveChange => ({
  seatings: raw.seatings.map(toSeating),
  clearedSeatings: raw.clearedSeatings.map(toSeating),
  checks: raw.checks.map(toCheck),
  tickets: raw.tickets.map(toTicket),
  voids: raw.voids.map(toVoid),
  orders: raw.orders.map(toOrder),
  payments: raw.payments.map(toPayment),
  waitlist: raw.waitlist.map(toEntry),
});

/** A failed mutation still notifies subscribers, with an empty result, so this is checked. */
const isChange = (raw: unknown): raw is Schema['LiveChange']['type'] =>
  typeof raw === 'object' && raw !== null && Array.isArray((raw as { checks?: unknown }).checks);

/** The one settings record. */
const STORE = 'store';

const byId = <T,>(items: T[], key: (item: T) => string): Record<string, T> =>
  Object.fromEntries(items.map((item) => [key(item), item]));

/** Call after Amplify.configure(). */
export function createAmplifyRepository(): Repository {
  const { models, queries, mutations, subscriptions } = generateClient<Schema>();

  // Saving leaves out an item's sold out flag and a table's QR token, which other
  // screens change, so an editor holding an older copy cannot undo them.
  const applyChange = async (change: CatalogChange): Promise<unknown> => {
    switch (change.type) {
      case 'category/save': {
        const { id, name, sortOrder, stationId, course } = change.category;
        const input = { id, name, sortOrder, stationId: stationId ?? null, course: course ?? null };
        return unwrap(
          change.isNew ? await models.MenuCategory.create(input) : await models.MenuCategory.update(input),
        );
      }
      case 'category/delete':
        return unwrap(await models.MenuCategory.delete({ id: change.id }));
      case 'item/save': {
        const { id, categoryId, name, price, sortOrder, optionGroups, stationId, noServiceCharge, course } = change.item;
        const input = {
          id,
          categoryId,
          name,
          price,
          sortOrder,
          optionGroups,
          stationId: stationId ?? null,
          noServiceCharge: noServiceCharge ?? null,
          course: course ?? null,
        };
        return unwrap(change.isNew ? await models.MenuItem.create(input) : await models.MenuItem.update(input));
      }
      case 'item/delete':
        return unwrap(await models.MenuItem.delete({ id: change.id }));
      case 'table/save': {
        const { id, name, seats, sortOrder, zone, qrToken } = change.table;
        const input = { id, name, seats, sortOrder, zone: zone ?? null };
        return unwrap(
          change.isNew
            ? await models.DiningTable.create({ ...input, qrToken: qrToken ?? crypto.randomUUID() })
            : await models.DiningTable.update(input),
        );
      }
      case 'table/delete':
        return unwrap(await models.DiningTable.delete({ id: change.id }));
      case 'station/save': {
        const { id, name, sortOrder } = change.station;
        const input = { id, name, sortOrder };
        return unwrap(change.isNew ? await models.Station.create(input) : await models.Station.update(input));
      }
      case 'station/delete':
        return unwrap(await models.Station.delete({ id: change.id }));
      case 'settings/save': {
        const { storeName, taxId, address, phone, serviceChargeRate } = change.settings;
        const input = { id: STORE, storeName, taxId, address, phone, serviceChargeRate };
        const existing = unwrap(await models.StoreSettings.get({ id: STORE }));
        return unwrap(existing ? await models.StoreSettings.update(input) : await models.StoreSettings.create(input));
      }
    }
  };

  const staff: StaffDirectory = {
    async list() {
      return unwrap(await queries.listStaff()) ?? [];
    },
    async invite(email, roles) {
      unwrap(await mutations.inviteStaff({ email, roles }));
    },
    async resendInvite(email) {
      unwrap(await mutations.resendStaffInvite({ email }));
    },
    async setRoles(username, roles) {
      unwrap(await mutations.setStaffRoles({ username, roles }));
    },
    async setEnabled(username, enabled) {
      unwrap(await mutations.setStaffEnabled({ username, enabled }));
    },
  };

  /** Runs one of the function's writes and returns what it changed. */
  const write = async (request: Promise<ModelResult<Schema['LiveChange']['type'] | null | undefined>>) => {
    const result = unwrap(await request);
    if (!result) throw new Error('the server returned nothing');
    return toChange(result);
  };

  const operations: LiveOperations = {
    openTable: (input) => write(mutations.openTable(input)),
    cancelTable: (checkId) => write(mutations.cancelTable({ checkId })),
    moveTable: (checkId, fromTableId, toTableId) => write(mutations.moveTable({ checkId, fromTableId, toTableId })),
    addTable: (checkId, tableId) => write(mutations.addTable({ checkId, tableId })),
    mergeChecks: (fromCheckId, intoCheckId) => write(mutations.mergeChecks({ fromCheckId, intoCheckId })),
    sendOrder: (input) => write(mutations.sendOrder(input)),
    confirmCustomerOrder: (orderId) => write(mutations.confirmCustomerOrder({ orderId })),
    rejectCustomerOrder: (orderId) => write(mutations.rejectCustomerOrder({ orderId })),
    setTicketStatus: (ticketId, status) => write(mutations.setTicketStatus({ ticketId, status })),
    fireCourse: (checkId, course) => write(mutations.fireCourse({ checkId, course })),
    serveTickets: (ticketIds) => write(mutations.serveTickets({ ticketIds })),
    requestVoid: (input) => write(mutations.requestVoid(input)),
    decideVoid: (voidId, approve) => write(mutations.decideVoid({ voidId, approve })),
    requestDiscount: (checkId, { id, ...request }) =>
      write(mutations.requestDiscount({ checkId, discountId: id, ...request })),
    decideDiscount: (checkId, discountId, approve) => write(mutations.decideDiscount({ checkId, discountId, approve })),
    removeDiscount: (checkId, discountId) => write(mutations.removeDiscount({ checkId, discountId })),
    requestBill: (checkId) => write(mutations.requestBill({ checkId })),
    recordPayment: (input) => write(mutations.recordPayment(input)),
    closeCheck: (checkId) => write(mutations.closeCheck({ checkId })),
    markTableCleaned: (tableId) => write(mutations.markTableCleaned({ tableId })),
    addToWaitlist: ({ id, ...input }) => write(mutations.addToWaitlist({ entryId: id, ...input })),
    cancelWaitlistEntry: (entryId, noShow) => write(mutations.cancelWaitlistEntry({ entryId, noShow })),
  };

  return {
    mode: 'amplify',
    staff,
    ...operations,

    async getCatalog(): Promise<Catalog> {
      const [tables, categories, items, stations, settings] = await Promise.all([
        listAll((nextToken) => models.DiningTable.list({ nextToken })),
        listAll((nextToken) => models.MenuCategory.list({ nextToken })),
        listAll((nextToken) => models.MenuItem.list({ nextToken })),
        listAll((nextToken) => models.Station.list({ nextToken })),
        models.StoreSettings.get({ id: STORE }).then(unwrap),
      ]);
      return {
        tables: tables
          .map(({ id, name, seats, sortOrder, zone, qrToken }) => ({ id, name, seats, sortOrder, zone, qrToken }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
        categories: toCategories(categories),
        items: toMenuItems(items),
        stations: stations
          .map(({ id, name, sortOrder }) => ({ id, name, sortOrder }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
        settings: settings
          ? {
              storeName: settings.storeName,
              taxId: settings.taxId,
              address: settings.address,
              phone: settings.phone,
              serviceChargeRate: settings.serviceChargeRate,
            }
          : defaultSettings,
      };
    },

    async seedCatalog() {
      const writes = [
        ...sampleCatalog.stations.map((station) => models.Station.create(station)),
        models.StoreSettings.create({ id: STORE, ...sampleCatalog.settings }),
        ...sampleCatalog.tables.map((table) => models.DiningTable.create({ ...table, qrToken: crypto.randomUUID() })),
        ...sampleCatalog.categories.map((category) => models.MenuCategory.create(category)),
        ...sampleCatalog.items.map((item) => models.MenuItem.create(item)),
      ];
      await Promise.all(
        writes.map((request) => (request as Promise<ModelResult<unknown>>).then(unwrap).catch(ignoreConflict)),
      );
    },

    async changeCatalog(changes) {
      await Promise.all(changes.map(applyChange));
    },

    async setItemAvailable(itemId, available) {
      unwrap(await mutations.setItemAvailable({ itemId, available }));
    },

    async rotateTableToken(tableId) {
      unwrap(await models.DiningTable.update({ id: tableId, qrToken: crypto.randomUUID() }));
    },

    async loadLiveState(): Promise<LiveState> {
      const seatings = await listAll((nextToken) => models.Seating.list({ nextToken }));
      const seatedCheckIds = seatings.map((seating) => seating.checkId);
      const activeStatuses: TicketStatus[] = ['HELD', 'NEW', 'PREPARING', 'READY'];

      const [orders, waitlist, checks, checkTickets, activeTickets, payments] = await Promise.all([
        listAll((nextToken) => models.Order.ordersByStatus({ status: 'PENDING' }, { nextToken })),
        listAll((nextToken) => models.WaitlistEntry.waitlistByStatus({ status: 'WAITING' }, { nextToken })),
        Promise.all(seatedCheckIds.map(async (id) => unwrap(await models.GuestCheck.get({ id })))),
        Promise.all(
          seatedCheckIds.map((checkId) =>
            listAll((nextToken) => models.KitchenTicket.ticketsByCheck({ checkId }, { nextToken })),
          ),
        ),
        Promise.all(
          activeStatuses.map((status) =>
            listAll((nextToken) => models.KitchenTicket.ticketsByStatus({ status }, { nextToken })),
          ),
        ),
        Promise.all(
          seatedCheckIds.map((checkId) =>
            listAll((nextToken) => models.Payment.paymentsByCheck({ checkId }, { nextToken })),
          ),
        ),
      ]);

      const tickets = [...checkTickets.flat(), ...activeTickets.flat()];
      const voidCheckIds = [...new Set([...seatedCheckIds, ...tickets.map((ticket) => ticket.checkId)])];
      const voids = await Promise.all(
        voidCheckIds.map((checkId) =>
          listAll((nextToken) => models.LineVoid.voidsByCheck({ checkId }, { nextToken })),
        ),
      );

      return {
        seatings: byId(seatings.map(toSeating), (seating) => seating.tableId),
        checks: byId(
          checks.flatMap((check) => (check ? [toCheck(check)] : [])),
          (check) => check.id,
        ),
        tickets: byId(tickets.map(toTicket), (ticket) => ticket.id),
        voids: byId(voids.flat().map(toVoid), (lineVoid) => lineVoid.id),
        orders: byId(orders.map(toOrder), (order) => order.id),
        payments: byId(payments.flat().map(toPayment), (payment) => payment.id),
        waitlist: byId(waitlist.map(toEntry), (entry) => entry.id),
      };
    },

    subscribe({ onChange, onConnection }) {
      const onError = () => onConnection(false);
      const listeners = [
        subscriptions.onLiveChange().subscribe({
          next: (raw) => {
            if (isChange(raw)) onChange(toChange(raw));
          },
          error: onError,
        }),
        // Customers can call placeOrder, and the caller chooses which fields a
        // result carries, so the minute resync recovers anything skipped here.
        subscriptions.onOrderPlaced().subscribe({
          next: (order) => {
            if (order?.status === 'PENDING' && order.lines) {
              onChange({
                orders: [
                  {
                    id: order.id,
                    source: 'CUSTOMER',
                    tableId: order.tableId,
                    tableName: order.tableName,
                    status: 'PENDING',
                    lines: order.lines,
                    total: order.total,
                    createdAt: order.createdAt,
                    expiresAt: order.expiresAt,
                    ticketIds: [],
                    updatedAt: order.createdAt,
                  },
                ],
              });
            }
          },
          error: onError,
        }),
      ];

      const stopListening = Hub.listen('api', ({ payload }) => {
        if (payload.event !== CONNECTION_STATE_CHANGE) return;
        const { connectionState } = payload.data as { connectionState: ConnectionState };
        onConnection(
          connectionState === ConnectionState.Connected ||
            connectionState === ConnectionState.ConnectedPendingKeepAlive,
        );
      });

      return () => {
        stopListening();
        listeners.forEach((listener) => listener.unsubscribe());
      };
    },

    async getDailyRecords(date) {
      const records = unwrap(await queries.getDailyRecords({ date }));
      if (!records) throw new Error('failed to load the daily report');
      return {
        payments: records.payments.map(toPayment),
        checks: records.checks.map(toCheck),
        tickets: records.tickets.map(toTicket),
        voids: records.voids.map(toVoid),
      };
    },
  };
}
