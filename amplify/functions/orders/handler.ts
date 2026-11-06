import { randomUUID } from 'node:crypto';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  businessDate,
  businessDay,
  effectiveOrderStatus,
  isBusinessDate,
  isTakeout,
  pendingLimitFor,
  pickupLabel,
  TAKEOUT_TABLE_ID,
  ORDER_LIFETIME_MS,
  OrderRejectedError,
  priceOrder,
  ticketIdForOrder,
  voidId,
  type KitchenTicket,
  type LineVoid,
  type MenuItem,
  type Order,
  type OrderItemInput,
  type PaymentMethod,
} from '../../../src/domain';

const db = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = (name: string) => {
  const value = process.env[`${name}_TABLE`];
  if (!value) throw new Error(`missing table name for ${name}`);
  return value;
};
const TABLES = {
  dining: tableName('DININGTABLE'),
  menu: tableName('MENUITEM'),
  order: tableName('ORDER'),
  ticket: tableName('KITCHENTICKET'),
  check: tableName('GUESTCHECK'),
  seating: tableName('SEATING'),
  lineVoid: tableName('LINEVOID'),
  pickup: tableName('PICKUPCOUNTER'),
};

/** Amplify's data API expects these on every record it reads. */
const record = (typename: string, now: string) => ({
  __typename: typename,
  createdAt: now,
  updatedAt: now,
});

const getItem = async <T>(TableName: string, Key: Record<string, string>) =>
  (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item as T | undefined;

async function getOrder(orderId: string) {
  return getItem<Order>(TABLES.order, { id: orderId });
}

async function voidedLineIds(order: Order) {
  const ticketId = ticketIdForOrder(order.id);
  const { Responses } = await db.send(
    new BatchGetCommand({
      RequestItems: {
        [TABLES.lineVoid]: {
          Keys: order.lines.map((line) => ({ id: voidId(ticketId, line.id) })),
          ProjectionExpression: 'lineId',
        },
      },
    }),
  );
  return (Responses?.[TABLES.lineVoid] ?? []).map((lineVoid) => lineVoid.lineId as string);
}

async function toCustomerOrder(order: Order) {
  const status = effectiveOrderStatus(order, Date.now());
  const ticket =
    status === 'PAID'
      ? await getItem<KitchenTicket>(TABLES.ticket, { id: ticketIdForOrder(order.id) })
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
    paidAt: order.paidAt,
    ticketStatus: ticket?.status,
    voidedLineIds: status === 'PAID' ? await voidedLineIds(order) : [],
    pickupNumber: order.pickupNumber,
  };
}

async function getMenuItems(items: OrderItemInput[]): Promise<MenuItem[]> {
  // The request is checked for size in priceOrder, but that needs the menu first.
  if (items.length === 0 || items.length > 50) throw new OrderRejectedError('INVALID_ITEMS');
  const ids = [...new Set(items.map((item) => item.menuItemId))];
  const { Responses } = await db.send(
    new BatchGetCommand({
      RequestItems: { [TABLES.menu]: { Keys: ids.map((id) => ({ id })) } },
    }),
  );
  return (Responses?.[TABLES.menu] ?? []) as MenuItem[];
}

/**
 * The index is eventually consistent, so a burst can pass the limit by a few.
 * That is acceptable, because the limit only has to stop sustained flooding.
 */
async function hasRoomForPendingOrder(tableId: string) {
  const limit = pendingLimitFor(tableId);
  const now = Date.now();
  let count = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: TABLES.order,
        IndexName: 'ordersByStatusAndCreatedAt',
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
  } while (ExclusiveStartKey && count < limit);
  return count < limit;
}

async function createOrder(
  orderId: string,
  table: { id: string; name: string } | undefined,
  items: OrderItemInput[],
  expectedTotal: number,
  { limitPending }: { limitPending: boolean },
) {
  const existing = await getOrder(orderId);
  if (existing) return toCustomerOrder(existing);
  if (!table) throw new OrderRejectedError('TABLE_NOT_FOUND');
  if (limitPending && !(await hasRoomForPendingOrder(table.id))) {
    throw new OrderRejectedError('TOO_MANY_PENDING');
  }

  const { lines, total } = priceOrder(await getMenuItems(items), items, randomUUID);
  if (total !== expectedTotal) throw new OrderRejectedError('PRICE_CHANGED');

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const order: Order = {
    id: orderId,
    tableId: table.id,
    tableName: table.name,
    status: 'PENDING',
    lines,
    total,
    createdAt,
    expiresAt: new Date(now + ORDER_LIFETIME_MS).toISOString(),
  };
  try {
    await db.send(
      new PutCommand({
        TableName: TABLES.order,
        Item: { ...record('Order', createdAt), ...order },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    // A concurrent retry got there first.
    if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
    const winner = await getOrder(orderId);
    if (!winner) throw error;
    return toCustomerOrder(winner);
  }
  return toCustomerOrder(order);
}

async function nextRoundForCheck(checkId: string) {
  const { Items } = await db.send(
    new QueryCommand({
      TableName: TABLES.ticket,
      IndexName: 'kitchenTicketsByCheckId',
      KeyConditionExpression: 'checkId = :checkId',
      ExpressionAttributeValues: { ':checkId': checkId },
    }),
  );
  return (Items ?? []).reduce((max, ticket) => Math.max(max, ticket.round as number), 0) + 1;
}

/**
 * The next takeout number for the business day. Taken before the payment is
 * written, so a payment that then fails leaves a gap, which is harmless.
 */
async function nextPickupNumber(now: string) {
  const { Attributes } = await db.send(
    new UpdateCommand({
      TableName: TABLES.pickup,
      Key: { id: businessDate(now) },
      UpdateExpression:
        'ADD #value :one SET #typename = :typename, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
      ExpressionAttributeNames: { '#value': 'value', '#typename': '__typename' },
      ExpressionAttributeValues: { ':one': 1, ':typename': 'PickupCounter', ':now': now },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return Attributes?.value as number;
}

async function confirmPaymentOnce(orderId: string, paymentMethod: PaymentMethod) {
  const order = await getOrder(orderId);
  if (!order) throw new OrderRejectedError('ORDER_NOT_FOUND');

  const ticketId = ticketIdForOrder(orderId);
  const status = effectiveOrderStatus(order, Date.now());
  if (status === 'EXPIRED') throw new OrderRejectedError('ORDER_EXPIRED');
  if (status === 'PAID') {
    return { order, ticket: await getItem<KitchenTicket>(TABLES.ticket, { id: ticketId }) };
  }

  // Takeout never occupies the counter: each order is a check of its own.
  const takeout = isTakeout(order);
  const seating = takeout
    ? undefined
    : await getItem<{ checkId: string }>(TABLES.seating, { tableId: order.tableId });
  const checkId = seating?.checkId ?? randomUUID();
  const round = seating ? await nextRoundForCheck(checkId) : 1;
  const now = new Date().toISOString();
  const pickupNumber = takeout ? await nextPickupNumber(now) : undefined;
  const label = pickupNumber != null ? pickupLabel(pickupNumber) : order.tableName;

  const paidOrder: Order = { ...order, status: 'PAID', checkId, paymentMethod, paidAt: now, pickupNumber };
  const ticket: KitchenTicket = {
    id: ticketId,
    checkId,
    tableName: label,
    round,
    status: 'NEW',
    sentAt: now,
    lines: order.lines,
    pickupNumber,
  };
  const check = seating
    ? undefined
    : { id: checkId, tableId: order.tableId, tableName: label, openedAt: now };

  const openTable = takeout
    ? [{ Put: { TableName: TABLES.check, Item: { ...record('GuestCheck', now), ...check } } }]
    : !check
    ? [
        {
          // The table must still be on this check when the transaction commits.
          ConditionCheck: {
            TableName: TABLES.seating,
            Key: { tableId: order.tableId },
            ConditionExpression: 'checkId = :checkId',
            ExpressionAttributeValues: { ':checkId': checkId },
          },
        },
      ]
    : [
        {
          Put: {
            TableName: TABLES.check,
            Item: { ...record('GuestCheck', now), ...check },
          },
        },
        {
          Put: {
            TableName: TABLES.seating,
            Item: { ...record('Seating', now), tableId: order.tableId, checkId },
            ConditionExpression: 'attribute_not_exists(tableId)',
          },
        },
      ];

  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLES.order,
            Key: { id: orderId },
            UpdateExpression:
              'SET #status = :paid, checkId = :checkId, paymentMethod = :method, paidAt = :now, updatedAt = :now' +
              (pickupNumber != null ? ', pickupNumber = :pickup' : ''),
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':paid': 'PAID',
              ':pending': 'PENDING',
              ':checkId': checkId,
              ':method': paymentMethod,
              ':now': now,
              ...(pickupNumber != null ? { ':pickup': pickupNumber } : {}),
            },
          },
        },
        {
          Put: {
            TableName: TABLES.ticket,
            Item: { ...record('KitchenTicket', now), ...ticket },
            ConditionExpression: 'attribute_not_exists(id)',
          },
        },
        ...openTable,
      ],
    }),
  );
  return { order: paidOrder, ticket, check };
}

async function confirmPayment(orderId: string, paymentMethod: PaymentMethod) {
  // Losing a race, such as two payments opening one table, cancels the
  // transaction. Trying again sees what the winner wrote.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await confirmPaymentOnce(orderId, paymentMethod);
    } catch (error) {
      if (!(error instanceof TransactionCanceledException) || attempt === 3) throw error;
    }
  }
}

/** Every order paid on a business date, and the cancellations of their lines. */
async function dailyRecords(date: string) {
  if (!isBusinessDate(date)) throw new Error(`not a date: ${date}`);
  const { start, end } = businessDay(date);
  const orders: Order[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: TABLES.order,
        IndexName: 'ordersByStatusAndCreatedAt',
        // An order can only be paid before it expires, so one paid that day was
        // created at most one lifetime before the day began.
        KeyConditionExpression: '#status = :paid AND createdAt BETWEEN :from AND :end',
        FilterExpression: 'paidAt >= :start AND paidAt < :end',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':paid': 'PAID',
          ':from': new Date(Date.parse(start) - ORDER_LIFETIME_MS).toISOString(),
          ':start': start,
          ':end': end,
        },
        ExclusiveStartKey,
      }),
    );
    orders.push(...((page.Items ?? []) as Order[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const keys = orders.flatMap((order) =>
    order.lines.map((line) => ({ id: voidId(ticketIdForOrder(order.id), line.id) })),
  );
  const voids: LineVoid[] = [];
  for (let index = 0; index < keys.length; index += 100) {
    let pending: Record<string, unknown>[] = keys.slice(index, index + 100);
    // DynamoDB may return part of a batch when busy; the rest is asked for again.
    for (let attempt = 0; pending.length > 0 && attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      const result = await db.send(
        new BatchGetCommand({ RequestItems: { [TABLES.lineVoid]: { Keys: pending } } }),
      );
      voids.push(...((result.Responses?.[TABLES.lineVoid] ?? []) as LineVoid[]));
      pending = result.UnprocessedKeys?.[TABLES.lineVoid]?.Keys ?? [];
    }
    if (pending.length > 0) throw new Error('could not read every cancellation');
  }
  return { orders, voids };
}

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
  return Items?.[0] as { id: string; name: string } | undefined;
}

interface Event {
  fieldName: string;
  arguments: Record<string, never>;
}

export const handler = async ({ fieldName, arguments: args }: Event) => {
  switch (fieldName) {
    case 'placeOrder':
      return createOrder(
        args.orderId,
        await tableForToken(args.tableToken),
        args.items,
        args.expectedTotal,
        { limitPending: true },
      );
    case 'placeStaffOrder':
      return createOrder(
        args.orderId,
        await getItem(TABLES.dining, { id: args.tableId }),
        args.items,
        args.expectedTotal,
        // Flooding must not stop staff taking orders at the counter.
        { limitPending: false },
      );
    case 'confirmOrderPayment':
      return confirmPayment(args.orderId, args.paymentMethod);
    case 'getCustomerTable': {
      const table = await tableForToken(args.tableToken);
      return table ? { name: table.name, takeout: table.id === TAKEOUT_TABLE_ID } : null;
    }
    case 'getDailyRecords':
      return dailyRecords(args.date);
    case 'getCustomerOrder': {
      const order = await getOrder(args.orderId);
      return order ? toCustomerOrder(order) : null;
    }
    default:
      throw new Error(`unknown field ${fieldName}`);
  }
};
