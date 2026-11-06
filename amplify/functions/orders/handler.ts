import { randomUUID } from 'node:crypto';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  assignStations,
  balanceOf,
  billedLine,
  businessDate,
  closeCheckRecord,
  effectiveOrderStatus,
  isBusinessDate,
  isReason,
  lineAmount,
  lineKey,
  MAX_PENDING_ORDERS_PER_TABLE,
  newCheck,
  newWaitlistEntry,
  ORDER_LIFETIME_MS,
  parseLineKey,
  paymentAmount,
  priceOrder,
  RejectedError,
  rolesFor,
  roundStatus,
  splitIntoTickets,
  stampAfter as stamp,
  voidableLine,
  voidId,
  withPayment,
  withRound,
  type DiningTable,
  type GuestCheck,
  type KitchenTicket,
  type LineVoid,
  type LiveChange,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItemInput,
  type Payment,
  type PaymentKind,
  type PaymentMethod,
  type Seating,
  type Station,
  type TicketLine,
  type TicketStatus,
  type WaitlistEntry,
} from '../../../src/domain';

const db = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient();

const tableName = (name: string) => {
  const value = process.env[`${name}_TABLE`];
  if (!value) throw new Error(`missing table name for ${name}`);
  return value;
};
const TABLES = {
  dining: tableName('DININGTABLE'),
  menu: tableName('MENUITEM'),
  category: tableName('MENUCATEGORY'),
  station: tableName('STATION'),
  seating: tableName('SEATING'),
  check: tableName('GUESTCHECK'),
  order: tableName('ORDER'),
  ticket: tableName('KITCHENTICKET'),
  lineVoid: tableName('LINEVOID'),
  payment: tableName('PAYMENT'),
  waitlist: tableName('WAITLISTENTRY'),
};

type Key = Record<string, string>;
type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** Amplify's data API expects these on every record it reads. */
const meta = (typename: string, now: string) => ({ __typename: typename, createdAt: now, updatedAt: now });

const getItem = async <T>(TableName: string, Key: Key) =>
  (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item as T | undefined;

async function batchGet<T>(TableName: string, keys: Key[]): Promise<T[]> {
  // A batch must not name the same key twice.
  const unique = [...new Map(keys.map((key) => [JSON.stringify(key), key])).values()];
  const results: T[] = [];
  for (let index = 0; index < unique.length; index += 100) {
    let pending = unique.slice(index, index + 100);
    // DynamoDB may return part of a batch when busy; the rest is asked for again.
    for (let attempt = 0; pending.length > 0 && attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      const result = await db.send(
        new BatchGetCommand({ RequestItems: { [TableName]: { Keys: pending, ConsistentRead: true } } }),
      );
      results.push(...((result.Responses?.[TableName] ?? []) as T[]));
      pending = (result.UnprocessedKeys?.[TableName]?.Keys ?? []) as Key[];
    }
    if (pending.length > 0) throw new Error(`could not read every record from ${TableName}`);
  }
  return results;
}

async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...((page.Items ?? []) as T[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const transact = (TransactItems: TransactItem[]) => db.send(new TransactWriteCommand({ TransactItems }));

/**
 * Writes a whole check, provided nobody has changed it since it was read. Every
 * change to a check goes through here, so its totals are always checked
 * against the version they were worked out from.
 */
const putCheck = (previous: GuestCheck, next: GuestCheck): TransactItem => ({
  Put: {
    TableName: TABLES.check,
    Item: { ...previous, ...next },
    ConditionExpression: 'updatedAt = :previous',
    ExpressionAttributeValues: { ':previous': previous.updatedAt },
  },
});

const putNew = (TableName: string, typename: string, record: { id: string }, now: string): TransactItem => ({
  Put: {
    TableName,
    Item: { ...meta(typename, now), ...record },
    ConditionExpression: 'attribute_not_exists(id)',
  },
});

/** Writes a record that must still have the status it was read with. */
const putFrom = <T extends { status: string }>(TableName: string, previous: T, next: T): TransactItem => ({
  Put: {
    TableName,
    Item: { ...previous, ...next },
    ConditionExpression: '#status = :previous',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':previous': previous.status },
  },
});

/**
 * Losing a race cancels the transaction. Running the request again reads what
 * the winner wrote, and either succeeds, finds it already done, or is refused.
 */
async function retrying<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;
      if (attempt === 3) throw new RejectedError('CONFLICT');
    }
  }
}

/** Every list is required in the schema. */
const change = (partial: LiveChange): Required<LiveChange> => ({
  seatings: [],
  clearedSeatings: [],
  checks: [],
  tickets: [],
  voids: [],
  orders: [],
  payments: [],
  waitlist: [],
  ...partial,
});

interface Identity {
  username?: string;
  groups?: string[] | null;
}

const names = new Map<string, string>();

/** The sign-in email, which the access token does not carry. Kept while the function is warm. */
async function actorName(identity: Identity | null) {
  const username = identity?.username;
  if (!username) return '未知';
  const known = names.get(username);
  if (known) return known;
  const { UserAttributes } = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }),
  );
  const email = UserAttributes?.find((attribute) => attribute.Name === 'email')?.Value ?? username;
  names.set(username, email);
  return email;
}

const canApprove = (identity: Identity | null) =>
  (identity?.groups ?? []).some((group) => (rolesFor('approveVoid') as string[]).includes(group));

// ---------------------------------------------------------------------------
// Menu and ordering
// ---------------------------------------------------------------------------

async function loadMenu(menuItemIds: string[]) {
  const ids = [...new Set(menuItemIds)];
  if (ids.length === 0 || ids.length > 50) throw new RejectedError('INVALID_ITEMS');
  const items = await batchGet<MenuItem>(TABLES.menu, ids.map((id) => ({ id })));
  const categoryIds = [...new Set(items.map((item) => item.categoryId))];
  const categories = categoryIds.length
    ? await batchGet<MenuCategory>(TABLES.category, categoryIds.map((id) => ({ id })))
    : [];
  const stationIds = [...new Set([...items, ...categories].flatMap((record) => record.stationId ?? []))];
  const stations = stationIds.length
    ? await batchGet<Station>(TABLES.station, stationIds.map((id) => ({ id })))
    : [];
  return { items, categories, stations };
}

/** The writes that send a round: its tickets, and the check with the round on its bill. */
function roundWrites(check: GuestCheck, orderId: string, lines: TicketLine[], total: number, now: string) {
  const next = withRound(check, total, now);
  const tickets = splitIntoTickets({
    orderId,
    checkId: check.id,
    tableName: check.tableName,
    round: next.rounds,
    lines,
    sentAt: now,
  });
  return {
    tickets,
    check: next,
    items: [...tickets.map((ticket) => putNew(TABLES.ticket, 'KitchenTicket', ticket, now)), putCheck(check, next)],
  };
}

/** What an order already sent looks like now, for a request that was retried. */
async function sentChange(order: Order) {
  const [tickets, check] = await Promise.all([
    batchGet<KitchenTicket>(TABLES.ticket, order.ticketIds.map((id) => ({ id }))),
    order.checkId ? getItem<GuestCheck>(TABLES.check, { id: order.checkId }) : undefined,
  ]);
  return change({
    tickets,
    checks: check ? [check] : [],
    orders: order.source === 'CUSTOMER' ? [order] : [],
  });
}

async function sendOrder(args: { orderId: string; checkId: string; items: OrderItemInput[]; expectedTotal: number }) {
  const existing = await getItem<Order>(TABLES.order, { id: args.orderId });
  if (existing) return sentChange(existing);
  const check = await getItem<GuestCheck>(TABLES.check, { id: args.checkId });
  if (!check) throw new RejectedError('TABLE_NOT_OPEN');
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');

  const menu = await loadMenu(args.items.map((item) => item.menuItemId));
  const { lines, total } = priceOrder(menu.items, args.items, randomUUID);
  if (total !== args.expectedTotal) throw new RejectedError('PRICE_CHANGED');

  const now = stamp(check.updatedAt);
  const round = roundWrites(check, args.orderId, assignStations(lines, menu), total, now);
  const order: Order = {
    id: args.orderId,
    source: 'STAFF',
    tableId: check.tableId,
    tableName: check.tableName,
    checkId: check.id,
    status: 'SENT',
    lines: round.tickets.flatMap((ticket) => ticket.lines),
    total,
    createdAt: now,
    expiresAt: now,
    round: round.check.rounds,
    ticketIds: round.tickets.map((ticket) => ticket.id),
    decidedAt: now,
    updatedAt: now,
  };
  await transact([putNew(TABLES.order, 'Order', order, now), ...round.items]);
  return change({ checks: [round.check], tickets: round.tickets });
}

async function confirmCustomerOrder(orderId: string) {
  const order = await getItem<Order>(TABLES.order, { id: orderId });
  if (!order) throw new RejectedError('ORDER_NOT_FOUND');
  if (order.status === 'SENT') return sentChange(order);
  if (order.status === 'REJECTED') throw new RejectedError('ORDER_DECIDED');
  if (effectiveOrderStatus(order, Date.now()) === 'EXPIRED') throw new RejectedError('ORDER_EXPIRED');

  const seating = await getItem<Seating>(TABLES.seating, { tableId: order.tableId });
  const check = seating && (await getItem<GuestCheck>(TABLES.check, { id: seating.checkId }));
  if (!check || check.status !== 'OPEN') throw new RejectedError('TABLE_NOT_OPEN');

  const menu = await loadMenu(order.lines.map((line) => line.menuItemId));
  const now = stamp(check.updatedAt, order.updatedAt);
  const round = roundWrites(check, order.id, assignStations(order.lines, menu), order.total, now);
  const sent: Order = {
    ...order,
    checkId: check.id,
    status: 'SENT',
    lines: round.tickets.flatMap((ticket) => ticket.lines),
    round: round.check.rounds,
    ticketIds: round.tickets.map((ticket) => ticket.id),
    decidedAt: now,
    updatedAt: now,
  };
  await transact([
    putFrom(TABLES.order, order, sent),
    ...round.items,
    {
      // The party must still be at the table when it commits.
      ConditionCheck: {
        TableName: TABLES.seating,
        Key: { tableId: order.tableId },
        ConditionExpression: 'checkId = :checkId',
        ExpressionAttributeValues: { ':checkId': check.id },
      },
    },
  ]);
  return change({ orders: [sent], tickets: round.tickets, checks: [round.check] });
}

async function rejectCustomerOrder(orderId: string) {
  const order = await getItem<Order>(TABLES.order, { id: orderId });
  if (!order) throw new RejectedError('ORDER_NOT_FOUND');
  if (order.status === 'REJECTED') return change({ orders: [order] });
  if (order.status !== 'PENDING') throw new RejectedError('ORDER_DECIDED');
  const now = stamp(order.updatedAt);
  const rejected: Order = { ...order, status: 'REJECTED', decidedAt: now, updatedAt: now };
  await transact([putFrom(TABLES.order, order, rejected)]);
  return change({ orders: [rejected] });
}

// ---------------------------------------------------------------------------
// Tables and the waitlist
// ---------------------------------------------------------------------------

async function openTable(args: { checkId: string; tableId: string; guestCount: number; waitlistEntryId?: string | null }) {
  const entryOf = () =>
    args.waitlistEntryId ? getItem<WaitlistEntry>(TABLES.waitlist, { id: args.waitlistEntryId }) : undefined;
  const seating = await getItem<Seating>(TABLES.seating, { tableId: args.tableId });
  if (seating) {
    if (seating.checkId !== args.checkId) throw new RejectedError('TABLE_OCCUPIED');
    // A retry of a request that succeeded.
    const [check, entry] = await Promise.all([getItem<GuestCheck>(TABLES.check, { id: args.checkId }), entryOf()]);
    return change({ seatings: [seating], checks: check ? [check] : [], waitlist: entry ? [entry] : [] });
  }
  const table = await getItem<DiningTable>(TABLES.dining, { id: args.tableId });
  if (!table) throw new RejectedError('TABLE_NOT_FOUND');
  const entry = await entryOf();
  if (args.waitlistEntryId && entry?.status !== 'WAITING') throw new RejectedError('WAITLIST_DECIDED');

  const now = stamp();
  const check = newCheck({
    id: args.checkId,
    tableId: table.id,
    tableName: table.name,
    guestCount: args.guestCount,
    partyName: entry?.name,
    now,
  });
  const seated: WaitlistEntry | undefined = entry && {
    ...entry,
    status: 'SEATED',
    seatedAt: now,
    tableId: table.id,
    updatedAt: stamp(entry.updatedAt),
  };
  await transact([
    {
      Put: {
        TableName: TABLES.seating,
        Item: { ...meta('Seating', now), tableId: table.id, checkId: check.id },
        ConditionExpression: 'attribute_not_exists(tableId)',
      },
    },
    putNew(TABLES.check, 'GuestCheck', check, now),
    ...(entry && seated ? [putFrom(TABLES.waitlist, entry, seated)] : []),
  ]);
  return change({
    seatings: [{ tableId: table.id, checkId: check.id }],
    checks: [check],
    waitlist: seated ? [seated] : [],
  });
}

const deleteSeating = (seating: Seating): TransactItem => ({
  Delete: {
    TableName: TABLES.seating,
    Key: { tableId: seating.tableId },
    ConditionExpression: 'attribute_not_exists(tableId) OR checkId = :checkId',
    ExpressionAttributeValues: { ':checkId': seating.checkId },
  },
});

/** For a party that leaves before ordering anything. */
async function cancelTable(checkId: string) {
  const check = await getItem<GuestCheck>(TABLES.check, { id: checkId });
  if (!check) throw new RejectedError('TABLE_NOT_OPEN');
  const seating = { tableId: check.tableId, checkId };
  if (check.status === 'CANCELLED') return change({ checks: [check], clearedSeatings: [seating] });
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.rounds > 0) throw new RejectedError('CHECK_HAS_ORDERS');
  const now = stamp(check.updatedAt);
  const cancelled: GuestCheck = { ...check, status: 'CANCELLED', closedAt: now, updatedAt: now };
  await transact([putCheck(check, cancelled), deleteSeating(seating)]);
  return change({ checks: [cancelled], clearedSeatings: [seating] });
}

async function markTableCleaned(tableId: string) {
  const seating = await getItem<Seating>(TABLES.seating, { tableId });
  if (!seating) return change({});
  const check = await getItem<GuestCheck>(TABLES.check, { id: seating.checkId });
  if (check?.status === 'OPEN') throw new RejectedError('TABLE_NOT_CLEARABLE');
  await transact([deleteSeating(seating)]);
  return change({ clearedSeatings: [seating] });
}

async function addToWaitlist(args: { entryId: string; name: string; partySize: number; phone?: string | null }) {
  const existing = await getItem<WaitlistEntry>(TABLES.waitlist, { id: args.entryId });
  if (existing) return change({ waitlist: [existing] });
  const now = stamp();
  const entry = newWaitlistEntry({ id: args.entryId, name: args.name, partySize: args.partySize, phone: args.phone }, now);
  await transact([putNew(TABLES.waitlist, 'WaitlistEntry', entry, now)]);
  return change({ waitlist: [entry] });
}

async function cancelWaitlistEntry(entryId: string) {
  const entry = await getItem<WaitlistEntry>(TABLES.waitlist, { id: entryId });
  if (!entry || entry.status === 'SEATED') throw new RejectedError('WAITLIST_DECIDED');
  if (entry.status === 'CANCELLED') return change({ waitlist: [entry] });
  const cancelled: WaitlistEntry = { ...entry, status: 'CANCELLED', updatedAt: stamp(entry.updatedAt) };
  await transact([putFrom(TABLES.waitlist, entry, cancelled)]);
  return change({ waitlist: [cancelled] });
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

async function updateTicketStatus(ticket: KitchenTicket, status: TicketStatus) {
  const updatedAt = stamp(ticket.updatedAt);
  // Only the status changes, so what the kitchen was asked to cook stays as sent.
  await db.send(
    new UpdateCommand({
      TableName: TABLES.ticket,
      Key: { id: ticket.id },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': updatedAt },
    }),
  );
  return { ...ticket, status, updatedAt };
}

async function setTicketStatus(ticketId: string, status: TicketStatus) {
  const ticket = await getItem<KitchenTicket>(TABLES.ticket, { id: ticketId });
  if (!ticket) throw new RejectedError('TICKET_NOT_FOUND');
  return change({ tickets: [await updateTicketStatus(ticket, status)] });
}

/** Marks a round served, every station's ticket together. */
async function serveTickets(ticketIds: string[]) {
  const ids = [...new Set(ticketIds)];
  if (ids.length === 0 || ids.length > 25) throw new RejectedError('TICKET_NOT_FOUND');
  const tickets = await batchGet<KitchenTicket>(TABLES.ticket, ids.map((id) => ({ id })));
  if (tickets.length !== ids.length) throw new RejectedError('TICKET_NOT_FOUND');
  return change({ tickets: await Promise.all(tickets.map((ticket) => updateTicketStatus(ticket, 'SERVED'))) });
}

// ---------------------------------------------------------------------------
// Cancelling lines
// ---------------------------------------------------------------------------

/** Takes an approved line off the bill. */
function voidOnCheck(check: GuestCheck, line: TicketLine, now: string) {
  const next: GuestCheck = { ...check, billTotal: check.billTotal - lineAmount(line), updatedAt: now };
  return { next, write: putCheck(check, next) };
}

async function requestVoid(args: { ticketId: string; lineId: string; reason: string }, identity: Identity | null) {
  const reason = args.reason.trim();
  if (!isReason(reason)) throw new RejectedError('INVALID_REASON');
  const id = voidId(args.ticketId, args.lineId);
  const [ticket, existing] = await Promise.all([
    getItem<KitchenTicket>(TABLES.ticket, { id: args.ticketId }),
    getItem<LineVoid>(TABLES.lineVoid, { id }),
  ]);
  const check = ticket && (await getItem<GuestCheck>(TABLES.check, { id: ticket.checkId }));
  const line = voidableLine(check, ticket, args.lineId, existing);
  if (!check || !ticket) throw new RejectedError('LINE_NOT_FOUND');

  const approver = canApprove(identity);
  const name = await actorName(identity);
  const now = stamp(check.updatedAt, existing?.updatedAt);
  const lineVoid: LineVoid = {
    id,
    ticketId: ticket.id,
    checkId: check.id,
    lineId: line.id,
    reason,
    status: approver ? 'APPROVED' : 'REQUESTED',
    requestedBy: name,
    requestedAt: now,
    decidedBy: approver ? name : null,
    decidedAt: approver ? now : null,
    updatedAt: now,
  };
  const put: TransactItem = {
    Put: {
      TableName: TABLES.lineVoid,
      Item: { ...meta('LineVoid', now), ...lineVoid },
      // A rejected request may be made again.
      ConditionExpression: 'attribute_not_exists(id) OR #status = :rejected',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':rejected': 'REJECTED' },
    },
  };
  if (approver) {
    const { next, write } = voidOnCheck(check, line, now);
    await transact([put, write]);
    return change({ voids: [lineVoid], checks: [next] });
  }
  await transact([
    put,
    {
      ConditionCheck: {
        TableName: TABLES.check,
        Key: { id: check.id },
        ConditionExpression: '#status = :open AND paidTotal = :zero',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':open': 'OPEN', ':zero': 0 },
      },
    },
  ]);
  return change({ voids: [lineVoid] });
}

async function decideVoid(args: { voidId: string; approve: boolean }, identity: Identity | null) {
  const lineVoid = await getItem<LineVoid>(TABLES.lineVoid, { id: args.voidId });
  if (!lineVoid) throw new RejectedError('LINE_NOT_FOUND');
  const outcome = args.approve ? 'APPROVED' : 'REJECTED';
  if (lineVoid.status === outcome) return change({ voids: [lineVoid] });
  if (lineVoid.status !== 'REQUESTED') throw new RejectedError('VOID_DECIDED');

  const name = await actorName(identity);
  if (!args.approve) {
    const now = stamp(lineVoid.updatedAt);
    const rejected: LineVoid = { ...lineVoid, status: 'REJECTED', decidedBy: name, decidedAt: now, updatedAt: now };
    await transact([putFrom(TABLES.lineVoid, lineVoid, rejected)]);
    return change({ voids: [rejected] });
  }

  const [ticket, check] = await Promise.all([
    getItem<KitchenTicket>(TABLES.ticket, { id: lineVoid.ticketId }),
    getItem<GuestCheck>(TABLES.check, { id: lineVoid.checkId }),
  ]);
  const line = ticket?.lines.find((candidate) => candidate.id === lineVoid.lineId);
  if (!check || !line) throw new RejectedError('LINE_NOT_FOUND');
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.paidTotal > 0) throw new RejectedError('CHECK_PAYING');
  const now = stamp(check.updatedAt, lineVoid.updatedAt);
  const approved: LineVoid = { ...lineVoid, status: 'APPROVED', decidedBy: name, decidedAt: now, updatedAt: now };
  const { next, write } = voidOnCheck(check, line, now);
  await transact([putFrom(TABLES.lineVoid, lineVoid, approved), write]);
  return change({ voids: [approved], checks: [next] });
}

// ---------------------------------------------------------------------------
// The bill
// ---------------------------------------------------------------------------

async function requestBill(checkId: string) {
  const check = await getItem<GuestCheck>(TABLES.check, { id: checkId });
  if (!check) throw new RejectedError('TABLE_NOT_OPEN');
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.billRequestedAt) return change({ checks: [check] });
  const now = stamp(check.updatedAt);
  const next: GuestCheck = { ...check, billRequestedAt: now, updatedAt: now };
  await transact([putCheck(check, next)]);
  return change({ checks: [next] });
}

/** What the lines named are worth, read consistently so that a line sent a moment ago counts. */
async function lineAmounts(checkId: string, keys: string[]) {
  const parsed = keys.map(parseLineKey);
  if (parsed.some((key) => !key)) throw new RejectedError('LINE_NOT_FOUND');
  const ticketIds = [...new Set(parsed.map((key) => key!.ticketId))];
  if (ticketIds.length > 100) throw new RejectedError('INVALID_PAYMENT');
  const [tickets, voids] = await Promise.all([
    batchGet<KitchenTicket>(TABLES.ticket, ticketIds.map((id) => ({ id }))),
    batchGet<LineVoid>(TABLES.lineVoid, keys.map((id) => ({ id }))),
  ]);
  const state = {
    tickets: Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket])),
    voids: Object.fromEntries(voids.map((lineVoid) => [lineVoid.id, lineVoid])),
  };
  return (key: string) => billedLine(state, checkId, key)?.amount;
}

async function recordPayment(args: {
  paymentId: string;
  checkId: string;
  method: PaymentMethod;
  kind: PaymentKind;
  amount?: number | null;
  parts?: number | null;
  lineKeys?: string[] | null;
  expectedAmount: number;
}) {
  const existing = await getItem<Payment>(TABLES.payment, { id: args.paymentId });
  if (existing) {
    const check = await getItem<GuestCheck>(TABLES.check, { id: existing.checkId });
    return change({ payments: [existing], checks: check ? [check] : [] });
  }
  const check = await getItem<GuestCheck>(TABLES.check, { id: args.checkId });
  if (!check) throw new RejectedError('TABLE_NOT_OPEN');
  const keys = args.kind === 'LINES' ? [...new Set(args.lineKeys ?? [])] : [];
  const amountOf = keys.length > 0 && keys.length <= 200 ? await lineAmounts(check.id, keys) : () => undefined;
  const { amount, lineKeys } = paymentAmount(check, args, amountOf);
  if (amount !== args.expectedAmount) throw new RejectedError('AMOUNT_CHANGED');

  const now = stamp(check.updatedAt);
  const payment: Payment = {
    id: args.paymentId,
    checkId: check.id,
    tableName: check.tableName,
    method: args.method,
    kind: args.kind,
    amount,
    parts: args.kind === 'SHARE' ? args.parts : null,
    lineKeys,
    paidAt: now,
    businessDate: businessDate(now),
  };
  const next = withPayment(check, payment, now);
  await transact([putNew(TABLES.payment, 'Payment', payment, now), putCheck(check, next)]);
  return change({ payments: [payment], checks: [next] });
}

/** Ends a bill with nothing left to pay, such as one whose lines were all cancelled. */
async function closeCheck(checkId: string) {
  const check = await getItem<GuestCheck>(TABLES.check, { id: checkId });
  if (!check) throw new RejectedError('TABLE_NOT_OPEN');
  if (check.status === 'CLOSED') return change({ checks: [check] });
  if (check.status !== 'OPEN') throw new RejectedError('CHECK_CLOSED');
  if (check.rounds === 0) throw new RejectedError('NOTHING_TO_PAY');
  if (balanceOf(check) > 0) throw new RejectedError('BALANCE_DUE');
  const next = closeCheckRecord(check, stamp(check.updatedAt));
  await transact([putCheck(check, next)]);
  return change({ checks: [next] });
}

async function dailyRecords(date: string) {
  if (!isBusinessDate(date)) throw new Error(`not a date: ${date}`);
  const byDate = (TableName: string, IndexName: string, attribute: string) =>
    queryAll<never>({
      TableName,
      IndexName,
      KeyConditionExpression: '#date = :date',
      ExpressionAttributeNames: { '#date': attribute },
      ExpressionAttributeValues: { ':date': date },
    });
  const byCheck = <T>(TableName: string, checkId: string) =>
    queryAll<T>({
      TableName,
      IndexName: 'byCheck',
      KeyConditionExpression: 'checkId = :checkId',
      ExpressionAttributeValues: { ':checkId': checkId },
    });
  const [payments, checks] = await Promise.all([
    byDate(TABLES.payment, 'byBusinessDate', 'businessDate') as Promise<Payment[]>,
    byDate(TABLES.check, 'byClosedDate', 'closedDate') as Promise<GuestCheck[]>,
  ]);
  const [tickets, voids] = await Promise.all([
    Promise.all(checks.map((check) => byCheck<KitchenTicket>(TABLES.ticket, check.id))),
    Promise.all(checks.map((check) => byCheck<LineVoid>(TABLES.lineVoid, check.id))),
  ]);
  return { payments, checks, tickets: tickets.flat(), voids: voids.flat() };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

async function tableForToken(tableToken: string) {
  const { Items } = await db.send(
    new QueryCommand({
      TableName: TABLES.dining,
      IndexName: 'byQrToken',
      KeyConditionExpression: 'qrToken = :token',
      ExpressionAttributeValues: { ':token': tableToken },
      Limit: 1,
    }),
  );
  return Items?.[0] as DiningTable | undefined;
}

/**
 * The index is eventually consistent, so a burst can pass the limit by a few.
 * That is acceptable, because the limit only has to stop sustained flooding.
 */
async function hasRoomForPendingOrder(tableId: string) {
  const now = Date.now();
  let count = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: TABLES.order,
        IndexName: 'byStatus',
        KeyConditionExpression: '#status = :pending AND createdAt >= :since',
        FilterExpression: 'tableId = :tableId AND expiresAt > :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pending': 'PENDING',
          ':since': new Date(now - ORDER_LIFETIME_MS).toISOString(),
          ':tableId': tableId,
          ':now': new Date(now).toISOString(),
        },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );
    count += page.Count ?? 0;
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey && count < MAX_PENDING_ORDERS_PER_TABLE);
  return count < MAX_PENDING_ORDERS_PER_TABLE;
}

async function toCustomerOrder(order: Order) {
  const status = effectiveOrderStatus(order, Date.now());
  const tickets =
    status === 'SENT' ? await batchGet<KitchenTicket>(TABLES.ticket, order.ticketIds.map((id) => ({ id }))) : [];
  const keys = tickets.flatMap((ticket) => ticket.lines.map((line) => lineKey(ticket.id, line.id)));
  const voids = keys.length ? await batchGet<LineVoid>(TABLES.lineVoid, keys.map((id) => ({ id }))) : [];
  const approved = voids.filter((lineVoid) => lineVoid.status === 'APPROVED');
  const kitchen = tickets.length
    ? roundStatus({ voids: Object.fromEntries(voids.map((lineVoid) => [lineVoid.id, lineVoid])) }, tickets)
    : undefined;
  return {
    id: order.id,
    tableId: order.tableId,
    tableName: order.tableName,
    status,
    lines: order.lines,
    total: order.total,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    kitchenStatus: kitchen === 'VOIDED' ? null : kitchen,
    voidedLineIds: approved.map((lineVoid) => lineVoid.lineId),
  };
}

async function placeOrder(args: { orderId: string; tableToken: string; items: OrderItemInput[]; expectedTotal: number }) {
  const existing = await getItem<Order>(TABLES.order, { id: args.orderId });
  if (existing) return toCustomerOrder(existing);
  const table = await tableForToken(args.tableToken);
  if (!table) throw new RejectedError('TABLE_NOT_FOUND');
  if (!(await hasRoomForPendingOrder(table.id))) throw new RejectedError('TOO_MANY_PENDING');

  const { lines, total } = priceOrder((await loadMenu(args.items.map((item) => item.menuItemId))).items, args.items, randomUUID);
  if (total !== args.expectedTotal) throw new RejectedError('PRICE_CHANGED');

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const order: Order = {
    id: args.orderId,
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
  try {
    await db.send(
      new PutCommand({
        TableName: TABLES.order,
        Item: { ...meta('Order', createdAt), ...order },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    // A concurrent retry got there first.
    if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
    const winner = await getItem<Order>(TABLES.order, { id: args.orderId });
    if (!winner) throw error;
    return toCustomerOrder(winner);
  }
  return toCustomerOrder(order);
}

// ---------------------------------------------------------------------------

interface Event {
  fieldName: string;
  // AppSync has already checked them against the schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments: any;
  identity: Identity | null;
}

export const handler = async ({ fieldName, arguments: args, identity }: Event) => {
  switch (fieldName) {
    case 'getCustomerTable': {
      const table = await tableForToken(args.tableToken);
      return table ? { name: table.name } : null;
    }
    case 'placeOrder':
      return placeOrder(args);
    case 'getCustomerOrder': {
      const order = await getItem<Order>(TABLES.order, { id: args.orderId });
      return order ? toCustomerOrder(order) : null;
    }
    case 'openTable':
      return retrying(() => openTable(args));
    case 'cancelTable':
      return retrying(() => cancelTable(args.checkId));
    case 'sendOrder':
      return retrying(() => sendOrder(args));
    case 'confirmCustomerOrder':
      return retrying(() => confirmCustomerOrder(args.orderId));
    case 'rejectCustomerOrder':
      return retrying(() => rejectCustomerOrder(args.orderId));
    case 'setTicketStatus':
      return setTicketStatus(args.ticketId, args.status);
    case 'serveTickets':
      return serveTickets(args.ticketIds);
    case 'requestVoid':
      return retrying(() => requestVoid(args, identity));
    case 'decideVoid':
      return retrying(() => decideVoid(args, identity));
    case 'requestBill':
      return retrying(() => requestBill(args.checkId));
    case 'recordPayment':
      return retrying(() => recordPayment(args));
    case 'closeCheck':
      return retrying(() => closeCheck(args.checkId));
    case 'markTableCleaned':
      return retrying(() => markTableCleaned(args.tableId));
    case 'addToWaitlist':
      return retrying(() => addToWaitlist(args));
    case 'cancelWaitlistEntry':
      return retrying(() => cancelWaitlistEntry(args.entryId));
    case 'getDailyRecords':
      return dailyRecords(args.date);
    default:
      throw new Error(`unknown field ${fieldName}`);
  }
};
