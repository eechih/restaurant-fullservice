import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoCustomerRepository, createDemoRepository } from './data/demoRepository';
import { sampleCatalog } from './data/sampleCatalog';
import {
  applyCatalogChange,
  diningTables,
  MAX_PENDING_TAKEOUT_ORDERS,
  openTakeoutTickets,
  TAKEOUT_TABLE_ID,
  businessDate,
  businessDay,
  dailyReport,
  isBusinessDate,
  shiftDate,
  applyEvent,
  billTotal,
  buildLine,
  ConflictError,
  effectiveOrderStatus,
  emptyLiveState,
  isFullyVoided,
  MAX_PENDING_ORDERS_PER_TABLE,
  menuItemProblems,
  missingRequiredGroups,
  moveBy,
  nextRound,
  nextSortOrder,
  OrderRejectedError,
  pendingOrders,
  priceOrder,
  tableState,
  ticketIdForOrder,
  toggleChoice,
  unitPriceOf,
  unservedTickets,
  voidId,
  type KitchenTicket,
  type LiveState,
  type MenuItem,
  type TicketLine,
} from './domain';

const item = (id: string): MenuItem => {
  const found = sampleCatalog.items.find((candidate) => candidate.id === id);
  assert.ok(found);
  return found;
};

const line = (id: string, unitPrice: number, quantity = 1): TicketLine => ({
  id,
  menuItemId: 'm',
  name: id,
  quantity,
  unitPrice,
  options: [],
});

const ticket = (id: string, lines: TicketLine[], round = 1): KitchenTicket => ({
  id,
  checkId: 'c1',
  tableName: 'A1',
  round,
  status: 'NEW',
  sentAt: `2026-11-04T10:0${round}:00.000Z`,
  lines,
});

const withVoid = (state: LiveState, ticketId: string, lineId: string): LiveState =>
  applyEvent(state, {
    type: 'void/upsert',
    lineVoid: {
      id: voidId(ticketId, lineId),
      ticketId,
      checkId: 'c1',
      lineId,
      reason: '點錯',
      voidedAt: '2026-11-04T10:05:00.000Z',
    },
  });

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

test('unit price adds every selected option to the base price', () => {
  const noodle = item('item-beef-noodle');
  const selection = { 'noodle-addons': ['addon-egg', 'addon-beef'], spice: ['spice-hot'] };
  assert.equal(unitPriceOf(noodle, selection), 180 + 15 + 60);
});

test('a required group must have a choice', () => {
  const tea = item('item-black-tea');
  assert.deepEqual(
    missingRequiredGroups(tea, { sugar: ['sugar-half'] }).map((group) => group.id),
    ['ice'],
  );
  assert.deepEqual(missingRequiredGroups(tea, { sugar: ['sugar-half'], ice: ['ice-none'] }), []);
});

test('single choice groups replace, multiple choice groups accumulate', () => {
  const noodle = item('item-beef-noodle');
  const [spice, addOns] = noodle.optionGroups;
  let selection = toggleChoice({}, spice, 'spice-mild');
  selection = toggleChoice(selection, spice, 'spice-hot');
  assert.deepEqual(selection.spice, ['spice-hot']);
  selection = toggleChoice(selection, spice, 'spice-hot');
  assert.deepEqual(selection.spice, ['spice-hot'], 'a required choice stays selected');

  selection = toggleChoice(selection, addOns, 'addon-egg');
  selection = toggleChoice(selection, addOns, 'addon-beef');
  assert.deepEqual(selection['noodle-addons'], ['addon-egg', 'addon-beef']);
  selection = toggleChoice(selection, addOns, 'addon-egg');
  assert.deepEqual(selection['noodle-addons'], ['addon-beef']);
});

test('a line keeps its price and options after the menu changes', () => {
  const noodle = structuredClone(item('item-beef-noodle'));
  const built = buildLine('l1', noodle, { spice: ['spice-hot'], 'noodle-addons': ['addon-egg'] }, 2, '  不要蔥 ');
  noodle.price = 999;
  assert.equal(built.unitPrice, 195);
  assert.equal(built.quantity, 2);
  assert.equal(built.note, '不要蔥');
  assert.deepEqual(built.options.map((option) => option.choiceName), ['大辣', '加滷蛋']);
});

test('the bill spans every round and excludes voided lines', () => {
  let state = applyEvent(emptyLiveState, {
    type: 'ticket/upsert',
    ticket: ticket('t1', [line('a', 100, 2), line('b', 50)], 1),
  });
  state = applyEvent(state, { type: 'ticket/upsert', ticket: ticket('t2', [line('c', 30)], 2) });
  assert.equal(billTotal(state, 'c1'), 280);
  assert.equal(nextRound(state, 'c1'), 3);

  state = withVoid(state, 't1', 'b');
  assert.equal(billTotal(state, 'c1'), 230);
});

test('a fully voided ticket needs no service', () => {
  let state = applyEvent(emptyLiveState, {
    type: 'ticket/upsert',
    ticket: ticket('t1', [line('a', 100), line('b', 50)]),
  });
  state = withVoid(state, 't1', 'a');
  assert.equal(isFullyVoided(state, state.tickets.t1), false);
  assert.equal(unservedTickets(state, 'c1').length, 1);

  state = withVoid(state, 't1', 'b');
  assert.equal(isFullyVoided(state, state.tickets.t1), true);
  assert.equal(unservedTickets(state, 'c1').length, 0);
});

test('a table moves from empty to dining and back to empty', async () => {
  const repository = createDemoRepository(memoryStorage());
  const tableId = 'table-A1';
  assert.equal(tableState(await repository.loadLiveState(), tableId), 'EMPTY');

  await repository.openTable({ tableId, tableName: 'A1', guestCount: 2 });
  assert.equal(tableState(await repository.loadLiveState(), tableId), 'DINING');

  await repository.clearTable(tableId);
  assert.equal(tableState(await repository.loadLiveState(), tableId), 'EMPTY');
});

test('opening an occupied table is rejected and keeps the first check', async () => {
  const repository = createDemoRepository(memoryStorage());
  const input = { tableId: 'table-A1', tableName: 'A1', guestCount: 2 };
  const first = await repository.openTable(input);
  await assert.rejects(repository.openTable(input), ConflictError);
  assert.equal((await repository.loadLiveState()).seatings['table-A1'].checkId, first.id);
});

test('retrying a void does not change it', async () => {
  const repository = createDemoRepository(memoryStorage());
  const lineVoid = {
    id: voidId('t1', 'a'),
    ticketId: 't1',
    checkId: 'c1',
    lineId: 'a',
    reason: '點錯',
    voidedAt: '2026-11-04T10:05:00.000Z',
  };
  await repository.voidLine(lineVoid);
  await repository.voidLine({ ...lineVoid, reason: '重送' });
  assert.equal((await repository.loadLiveState()).voids[lineVoid.id].reason, '點錯');
});

const lineIds = () => {
  let next = 0;
  return () => `line-${++next}`;
};
const rejection = (code: string) => (error: unknown) =>
  error instanceof OrderRejectedError && error.code === code;

test('an order is priced from the menu, not from the customer', () => {
  const { lines, total } = priceOrder(
    sampleCatalog.items,
    [
      {
        menuItemId: 'item-beef-noodle',
        quantity: 2,
        choiceIds: ['spice-hot', 'addon-egg'],
        note: ' 不要蔥 ',
      },
      { menuItemId: 'item-greens', quantity: 1, choiceIds: [] },
    ],
    lineIds(),
  );
  assert.equal(total, (180 + 15) * 2 + 40);
  assert.equal(lines[0].unitPrice, 195);
  assert.equal(lines[0].note, '不要蔥');
  assert.deepEqual(lines.map((priced) => priced.id), ['line-1', 'line-2']);
});

test('an order the menu does not allow is rejected', () => {
  const noodle = 'item-beef-noodle';
  const rejected: [string, Parameters<typeof priceOrder>[1]][] = [
    ['INVALID_ITEMS', []],
    ['ITEM_UNAVAILABLE', [{ menuItemId: 'no-such-item', quantity: 1, choiceIds: [] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 0, choiceIds: ['spice-hot'] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: -1, choiceIds: ['spice-hot'] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 1.5, choiceIds: ['spice-hot'] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 100, choiceIds: ['spice-hot'] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 1, choiceIds: [] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 1, choiceIds: ['spice-hot', 'spice-mild'] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 1, choiceIds: ['spice-hot', 'sugar-half'] }]],
    ['INVALID_ITEMS', [{ menuItemId: 'item-greens', quantity: 1, choiceIds: [], note: 'x'.repeat(201) }]],
  ];
  for (const [code, inputs] of rejected) {
    assert.throws(() => priceOrder(sampleCatalog.items, inputs, lineIds()), rejection(code), JSON.stringify(inputs));
  }
});

test('a sold out item cannot be ordered', () => {
  const menu = [{ ...item('item-greens'), available: false }];
  assert.throws(
    () => priceOrder(menu, [{ menuItemId: 'item-greens', quantity: 1, choiceIds: [] }], lineIds()),
    rejection('ITEM_UNAVAILABLE'),
  );
});

test('an unpaid order stops being pending once it expires', () => {
  const order = { status: 'PENDING', expiresAt: '2026-11-04T10:15:00.000Z' } as const;
  const expiry = new Date(order.expiresAt).getTime();
  assert.equal(effectiveOrderStatus(order, expiry - 1), 'PENDING');
  assert.equal(effectiveOrderStatus(order, expiry), 'EXPIRED');
  assert.equal(effectiveOrderStatus({ ...order, status: 'PAID' }, expiry), 'PAID');
});

const greens = [{ menuItemId: 'item-greens', quantity: 1, choiceIds: [] }];

async function demoRestaurant() {
  const storage = memoryStorage();
  const staff = createDemoRepository(storage);
  const customer = createDemoCustomerRepository(storage);
  await staff.seedCatalog();
  const table = (await staff.getCatalog()).tables[0];
  assert.ok(table.qrToken);
  return { staff, customer, table, tableToken: table.qrToken };
}

test('the kitchen gets nothing until the order is paid', async () => {
  const { staff, customer, table, tableToken } = await demoRestaurant();

  const placed = await customer.placeOrder({ orderId: 'o1', tableToken, items: greens, expectedTotal: 40 });
  assert.equal(placed.status, 'PENDING');
  assert.equal(placed.ticketStatus, undefined);
  let state = await staff.loadLiveState();
  assert.deepEqual(state.tickets, {});
  assert.equal(tableState(state, table.id), 'EMPTY', 'an unpaid order does not occupy the table');
  assert.deepEqual(pendingOrders(state, Date.now()).map((order) => order.id), ['o1']);

  await staff.confirmOrderPayment('o1', 'CASH');
  state = await staff.loadLiveState();
  const ticket = state.tickets[ticketIdForOrder('o1')];
  assert.equal(ticket.status, 'NEW');
  assert.equal(ticket.lines[0].unitPrice, 40);
  assert.equal(tableState(state, table.id), 'DINING', 'the first paid order opens the table');
  assert.equal(state.orders.o1.paymentMethod, 'CASH');
  assert.deepEqual(pendingOrders(state, Date.now()), []);

  const paid = await customer.getOrder('o1');
  assert.equal(paid?.status, 'PAID');
  assert.equal(paid?.ticketStatus, 'NEW');
});

test('each order at a table becomes the next round on the same check', async () => {
  const { staff, customer, table, tableToken } = await demoRestaurant();
  await customer.placeOrder({ orderId: 'o1', tableToken, items: greens, expectedTotal: 40 });
  await customer.placeOrder({ orderId: 'o2', tableToken, items: greens, expectedTotal: 40 });
  await staff.confirmOrderPayment('o1', 'CASH');
  await staff.confirmOrderPayment('o2', 'CARD');

  const state = await staff.loadLiveState();
  const first = state.tickets[ticketIdForOrder('o1')];
  const second = state.tickets[ticketIdForOrder('o2')];
  assert.equal(first.checkId, state.seatings[table.id].checkId);
  assert.equal(second.checkId, first.checkId);
  assert.deepEqual([first.round, second.round], [1, 2]);
  assert.equal(billTotal(state, first.checkId), 80);
});

test('retrying an order or a payment does not duplicate it or reset progress', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const input = { orderId: 'o1', tableToken, items: greens, expectedTotal: 40 };
  const first = await customer.placeOrder(input);
  assert.deepEqual(await customer.placeOrder(input), first);

  await staff.confirmOrderPayment('o1', 'CASH');
  const ticketId = ticketIdForOrder('o1');
  await staff.setTicketStatus(ticketId, 'PREPARING');
  await staff.confirmOrderPayment('o1', 'CARD');

  const state = await staff.loadLiveState();
  assert.equal(state.tickets[ticketId].status, 'PREPARING');
  assert.equal(state.orders.o1.paymentMethod, 'CASH');
});

test('an order is rejected when the table is unknown or the price moved', async () => {
  const { customer, tableToken } = await demoRestaurant();
  await assert.rejects(
    customer.placeOrder({ orderId: 'o1', tableToken: 'guessed', items: greens, expectedTotal: 40 }),
    rejection('TABLE_NOT_FOUND'),
  );
  await assert.rejects(
    customer.placeOrder({ orderId: 'o2', tableToken, items: greens, expectedTotal: 1 }),
    rejection('PRICE_CHANGED'),
  );
  assert.equal(await customer.getOrder('o2'), null);
});

test('one table cannot flood the pending list, and recovers once orders clear', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T10:00:00.000Z') });
  const { staff, customer, table, tableToken } = await demoRestaurant();
  const place = (orderId: string, token = tableToken) =>
    customer.placeOrder({ orderId, tableToken: token, items: greens, expectedTotal: 40 });
  for (let index = 0; index < MAX_PENDING_ORDERS_PER_TABLE; index += 1) await place(`o${index}`);

  await assert.rejects(place('extra'), rejection('TOO_MANY_PENDING'));
  assert.equal((await place('o0')).id, 'o0', 'a retry is not a new order');

  const otherTable = (await staff.getCatalog()).tables[1];
  assert.ok(otherTable.qrToken);
  await place('elsewhere', otherTable.qrToken);

  await staff.placeStaffOrder({ orderId: 'counter', tableId: table.id, items: greens, expectedTotal: 40 });
  await staff.confirmOrderPayment('counter', 'CASH');
  await staff.confirmOrderPayment('o0', 'CASH');
  await place('after-payment');
  await assert.rejects(place('extra'), rejection('TOO_MANY_PENDING'));

  context.mock.timers.setTime(Date.parse('2026-11-04T10:15:00.000Z'));
  assert.equal((await place('after-expiry')).status, 'PENDING');
});

test('a customer sees which paid lines were cancelled', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const two = [...greens, { menuItemId: 'item-tofu', quantity: 1, choiceIds: [] }];
  const placed = await customer.placeOrder({ orderId: 'o1', tableToken, items: two, expectedTotal: 90 });
  assert.deepEqual(placed.voidedLineIds, []);
  await staff.confirmOrderPayment('o1', 'CASH');

  const ticketId = ticketIdForOrder('o1');
  const { checkId } = (await staff.loadLiveState()).tickets[ticketId];
  const lineId = placed.lines[1].id;
  await staff.voidLine({
    id: voidId(ticketId, lineId),
    ticketId,
    checkId,
    lineId,
    reason: '缺料',
    voidedAt: '2026-11-04T10:05:00.000Z',
  });
  assert.deepEqual((await customer.getOrder('o1'))?.voidedLineIds, [lineId]);
});

test('marking an item sold out stops new orders and can be undone', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const order = (orderId: string) =>
    customer.placeOrder({ orderId, tableToken, items: greens, expectedTotal: 40 });

  await staff.setItemAvailable('item-greens', false);
  await assert.rejects(order('o1'), rejection('ITEM_UNAVAILABLE'));

  await staff.setItemAvailable('item-greens', true);
  assert.equal((await order('o2')).status, 'PENDING');
});

test('an expired order cannot be paid', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T10:00:00.000Z') });
  const { staff, customer, tableToken } = await demoRestaurant();
  await customer.placeOrder({ orderId: 'o1', tableToken, items: greens, expectedTotal: 40 });

  context.mock.timers.setTime(Date.parse('2026-11-04T10:15:00.000Z'));
  assert.equal((await customer.getOrder('o1'))?.status, 'EXPIRED');
  await assert.rejects(staff.confirmOrderPayment('o1', 'CASH'), rejection('ORDER_EXPIRED'));
  assert.deepEqual((await staff.loadLiveState()).tickets, {});
});

test('an edited item keeps its sold out flag, and a new one starts available', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const greensItem = (await staff.getCatalog()).items.find((item) => item.id === 'item-greens');
  assert.ok(greensItem);
  await staff.setItemAvailable('item-greens', false);

  // The editor opened before the item sold out, so its copy is still available.
  await staff.changeCatalog([
    { type: 'item/save', item: { ...greensItem, price: 45, available: true }, isNew: false },
    {
      type: 'item/save',
      item: { ...greensItem, id: 'item-new', name: '燙地瓜葉', sortOrder: 999, available: false },
      isNew: true,
    },
  ]);
  const items = (await staff.getCatalog()).items;
  const edited = items.find((item) => item.id === 'item-greens');
  assert.equal(edited?.price, 45);
  assert.equal(edited?.available, false, 'saving does not undo sold out');
  assert.equal(items.find((item) => item.id === 'item-new')?.available, null);
  assert.equal(items.at(-1)?.id, 'item-new', 'items stay in sort order');

  const order = await customer.placeOrder({
    orderId: 'o1',
    tableToken,
    items: [{ menuItemId: 'item-new', quantity: 1, choiceIds: [] }],
    expectedTotal: 40,
  });
  assert.equal(order.lines[0].name, '燙地瓜葉');
});

test('editing a table keeps its QR code working', async () => {
  const { staff, customer, table, tableToken } = await demoRestaurant();
  await staff.changeCatalog([
    { type: 'table/save', table: { ...table, name: '窗邊 1', qrToken: 'stale' }, isNew: false },
  ]);
  assert.deepEqual(await customer.getTable(tableToken), { name: '窗邊 1', takeout: false });

  await staff.changeCatalog([{ type: 'table/delete', id: table.id }]);
  assert.equal(await customer.getTable(tableToken), null, 'a deleted table stops taking orders');
});

test('a price change rejects orders priced from the old menu', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const greensItem = (await staff.getCatalog()).items.find((item) => item.id === 'item-greens');
  assert.ok(greensItem);
  await staff.changeCatalog([{ type: 'item/save', item: { ...greensItem, price: 50 }, isNew: false }]);
  await assert.rejects(
    customer.placeOrder({ orderId: 'o1', tableToken, items: greens, expectedTotal: 40 }),
    rejection('PRICE_CHANGED'),
  );
});

test('a deleted category or item disappears from the catalog', () => {
  let catalog = applyCatalogChange(sampleCatalog, { type: 'item/delete', id: 'item-greens' });
  assert.ok(!catalog.items.some((item) => item.id === 'item-greens'));
  const [category] = catalog.categories;
  catalog = applyCatalogChange(catalog, { type: 'category/delete', id: category.id });
  assert.ok(!catalog.categories.some((candidate) => candidate.id === category.id));
});

test('moving a record swaps it with its neighbour', () => {
  const records = [
    { id: 'a', sortOrder: 10 },
    { id: 'b', sortOrder: 20 },
    { id: 'c', sortOrder: 30 },
  ];
  assert.deepEqual(moveBy(records, 'b', -1), [
    { id: 'b', sortOrder: 10 },
    { id: 'a', sortOrder: 20 },
  ]);
  assert.deepEqual(moveBy(records, 'b', 1), [
    { id: 'b', sortOrder: 30 },
    { id: 'c', sortOrder: 20 },
  ]);
  assert.equal(moveBy(records, 'a', -1), undefined);
  assert.equal(moveBy(records, 'c', 1), undefined);
  assert.deepEqual(moveBy([{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 1 }], 'b', -1), [
    { id: 'b', sortOrder: 0 },
  ]);
  assert.equal(nextSortOrder(records), 40);
  assert.equal(nextSortOrder([]), 10);
});

test('an item that cannot be ordered is not saved', () => {
  const item = sampleCatalog.items.find((candidate) => candidate.optionGroups.length > 0);
  assert.ok(item);
  assert.deepEqual(menuItemProblems(item), []);
  assert.deepEqual(menuItemProblems({ ...item, name: ' ', price: 1.5 }), [
    '品名必填，最多 40 字',
    '價格要是 0 到 100000 的整數',
  ]);
  const [group] = item.optionGroups;
  assert.deepEqual(
    menuItemProblems({ ...item, optionGroups: [{ ...group, choices: [] }] }),
    [`「${group.name}」至少要有一個選項`],
  );
  assert.deepEqual(
    menuItemProblems({
      ...item,
      optionGroups: [{ ...group, choices: [group.choices[0], { ...group.choices[0], id: 'x' }] }],
    }),
    [`「${group.name}」有重複的選項`],
  );
  assert.deepEqual(
    menuItemProblems({
      ...item,
      optionGroups: [{ ...group, choices: [{ ...group.choices[0], priceDelta: -10 }] }],
    }),
    [],
    'a choice may lower the price',
  );
});

test('a business day runs midnight to midnight in Taiwan', () => {
  assert.deepEqual(businessDay('2026-11-06'), {
    start: '2026-11-05T16:00:00.000Z',
    end: '2026-11-06T16:00:00.000Z',
  });
  assert.equal(businessDate('2026-11-05T15:59:59.999Z'), '2026-11-05');
  assert.equal(businessDate('2026-11-05T16:00:00.000Z'), '2026-11-06');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.ok(isBusinessDate('2026-02-28'));
  assert.ok(!isBusinessDate('2026-02-30'));
  assert.ok(!isBusinessDate('2026-2-3'));
  assert.throws(() => businessDay('yesterday'));
});

test('the daily report adds up takings, refunds and items by payment method', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const tofu = [{ menuItemId: 'item-tofu', quantity: 2, choiceIds: [] }];
  await customer.placeOrder({ orderId: 'o1', tableToken, items: greens, expectedTotal: 40 });
  await customer.placeOrder({ orderId: 'o2', tableToken, items: [...greens, ...tofu], expectedTotal: 140 });
  await customer.placeOrder({ orderId: 'o3', tableToken, items: greens, expectedTotal: 40 });
  await staff.confirmOrderPayment('o1', 'CASH');
  await staff.confirmOrderPayment('o2', 'CARD');
  // o3 is never paid, so it is not takings.

  const o2 = (await staff.loadLiveState()).orders.o2;
  const tofuLine = o2.lines.find((line) => line.menuItemId === 'item-tofu');
  assert.ok(tofuLine);
  const ticketId = ticketIdForOrder('o2');
  await staff.voidLine({
    id: voidId(ticketId, tofuLine.id),
    ticketId,
    checkId: o2.checkId!,
    lineId: tofuLine.id,
    reason: '缺料',
    voidedAt: new Date().toISOString(),
  });

  const today = businessDate(Date.now());
  const { orders, voids } = await staff.getDailyRecords(today);
  const report = dailyReport(orders, voids);
  assert.equal(report.orders, 2);
  assert.equal(report.received, 180);
  assert.equal(report.refunded, 100);
  assert.deepEqual(report.byPayment.CASH, { orders: 1, received: 40, refunded: 0 });
  assert.deepEqual(report.byPayment.CARD, { orders: 1, received: 140, refunded: 100 });
  assert.deepEqual(
    report.items.map(({ name, quantity, amount, voidedQuantity }) => [name, quantity, amount, voidedQuantity]),
    [
      ['燙青菜', 2, 80, 0],
      ['皮蛋豆腐', 0, 0, 2],
    ],
  );
  assert.deepEqual(
    report.refunds.map(({ name, amount, reason, paymentMethod }) => [name, amount, reason, paymentMethod]),
    [['皮蛋豆腐', 100, '缺料', 'CARD']],
  );

  const other = await staff.getDailyRecords(shiftDate(today, -1));
  assert.deepEqual(dailyReport(other.orders, other.voids).orders, 0, 'another day is empty');
});

async function takeoutToken(staff: Awaited<ReturnType<typeof demoRestaurant>>['staff']) {
  const takeout = (await staff.getCatalog()).tables.find((table) => table.id === TAKEOUT_TABLE_ID);
  assert.ok(takeout?.qrToken);
  return takeout.qrToken;
}

test('takeout orders get pickup numbers and never occupy a table', async () => {
  const { staff, customer } = await demoRestaurant();
  const token = await takeoutToken(staff);
  assert.deepEqual(await customer.getTable(token), { name: '外帶', takeout: true });

  await customer.placeOrder({ orderId: 't1', tableToken: token, items: greens, expectedTotal: 40 });
  await customer.placeOrder({ orderId: 't2', tableToken: token, items: greens, expectedTotal: 40 });
  assert.equal((await customer.getOrder('t1'))?.pickupNumber, undefined, 'no number until paid');
  // Paid out of order: numbers follow payment, not ordering.
  await staff.confirmOrderPayment('t2', 'CASH');
  await staff.confirmOrderPayment('t1', 'CARD');
  await staff.placeStaffOrder({ orderId: 't3', tableId: TAKEOUT_TABLE_ID, items: greens, expectedTotal: 40 });
  await staff.confirmOrderPayment('t3', 'CASH');

  const state = await staff.loadLiveState();
  assert.equal(state.seatings[TAKEOUT_TABLE_ID], undefined, 'takeout opens no table');
  const t1 = state.tickets[ticketIdForOrder('t1')];
  const t2 = state.tickets[ticketIdForOrder('t2')];
  assert.equal(t2.pickupNumber, 1);
  assert.equal(t1.pickupNumber, 2);
  assert.equal(state.tickets[ticketIdForOrder('t3')].pickupNumber, 3);
  assert.equal(t1.tableName, '外帶 #2', 'the kitchen sees the number');
  assert.notEqual(t1.checkId, t2.checkId, 'each takeout order is its own check');
  assert.equal(t1.round, 1);
  assert.equal((await customer.getOrder('t1'))?.pickupNumber, 2);
  assert.equal(state.orders.t1.pickupNumber, 2);

  assert.deepEqual(openTakeoutTickets(state).map((ticket) => ticket.pickupNumber), [1, 2, 3]);
  await staff.setTicketStatus(t2.id, 'SERVED');
  assert.deepEqual(openTakeoutTickets(await staff.loadLiveState()).map((ticket) => ticket.pickupNumber), [2, 3]);

  const { orders, voids } = await staff.getDailyRecords(businessDate(Date.now()));
  const report = dailyReport(orders, voids);
  assert.deepEqual(report.takeout, { orders: 3, received: 120 });
  assert.ok(!diningTables(await staff.getCatalog()).some((table) => table.id === TAKEOUT_TABLE_ID));
});

test('the takeout entry allows more unpaid orders than a table', async () => {
  const { customer, staff } = await demoRestaurant();
  const token = await takeoutToken(staff);
  for (let index = 0; index < MAX_PENDING_TAKEOUT_ORDERS; index += 1) {
    await customer.placeOrder({ orderId: `t${index}`, tableToken: token, items: greens, expectedTotal: 40 });
  }
  await assert.rejects(
    customer.placeOrder({ orderId: 'one-more', tableToken: token, items: greens, expectedTotal: 40 }),
    rejection('TOO_MANY_PENDING'),
  );
});
