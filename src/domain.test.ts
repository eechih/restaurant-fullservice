import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoCustomerRepository, createDemoRepository, demoActor, everyRole, type DemoActor } from './data/demoRepository';
import { sampleCatalog } from './data/sampleCatalog';
import {
  applyCatalogChange,
  applyChange,
  balanceOf,
  billFor,
  billOf,
  checkInvoice,
  isTaxId,
  kitchenReport,
  reservationsOn,
  waitingParties,
  buildLine,
  businessDate,
  businessDay,
  can,
  dailyReport,
  effectiveOrderStatus,
  emptyLiveState,
  isBusinessDate,
  isFullyVoided,
  lineKey,
  MAX_PENDING_ORDERS_PER_TABLE,
  menuItemProblems,
  missingRequiredGroups,
  moveBy,
  nextSortOrder,
  paymentAmount,
  pendingOrders,
  priceOrder,
  readyRounds,
  RejectedError,
  roundsForCheck,
  roundStatus,
  sharesLeft,
  shiftDate,
  stationFor,
  suggestTables,
  tableState,
  ticketIdFor,
  ticketsAtStation,
  toggleChoice,
  unitPriceOf,
  voidId,
  voidRequests,
  type Discount,
  type GuestCheck,
  type KitchenTicket,
  type LiveState,
  type MenuItem,
  type OrderItemInput,
  type Role,
} from './domain';

const item = (id: string): MenuItem => {
  const found = sampleCatalog.items.find((candidate) => candidate.id === id);
  assert.ok(found);
  return found;
};

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

const lineIds = () => {
  let next = 0;
  return () => `line-${++next}`;
};
const rejection = (code: string) => (error: unknown) => error instanceof RejectedError && error.code === code;

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

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

test('an order is priced from the menu, not from the device', () => {
  const { lines, total } = priceOrder(
    sampleCatalog.items,
    [
      { menuItemId: 'item-beef-noodle', quantity: 2, choiceIds: ['spice-hot', 'addon-egg'], note: ' 不要蔥 ' },
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
  const rejected: [string, OrderItemInput[]][] = [
    ['INVALID_ITEMS', []],
    ['ITEM_UNAVAILABLE', [{ menuItemId: 'no-such-item', quantity: 1, choiceIds: [] }]],
    ['INVALID_ITEMS', [{ menuItemId: noodle, quantity: 0, choiceIds: ['spice-hot'] }]],
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
  const soldOut = [{ ...item('item-greens'), available: false }];
  assert.throws(
    () => priceOrder(soldOut, [{ menuItemId: 'item-greens', quantity: 1, choiceIds: [] }], lineIds()),
    rejection('ITEM_UNAVAILABLE'),
  );
});

test('an item is cooked at its own station, else its category’s', () => {
  assert.equal(stationFor(sampleCatalog, 'item-beef-noodle'), 'station-noodle', 'the item overrides');
  assert.equal(stationFor(sampleCatalog, 'item-pork-rice'), 'station-wok', 'from the category');
  const withoutWok = { ...sampleCatalog, stations: sampleCatalog.stations.filter((s) => s.id !== 'station-wok') };
  assert.equal(stationFor(withoutWok, 'item-pork-rice'), null, 'a deleted station is no station');
});

// ---------------------------------------------------------------------------
// A demo restaurant, which applies the same rules as the server
// ---------------------------------------------------------------------------

const greens = { menuItemId: 'item-greens', quantity: 1, choiceIds: [] }; // 40, noodle station
const tofu = { menuItemId: 'item-tofu', quantity: 1, choiceIds: [] }; // 50, cold station
const beer = { menuItemId: 'item-beer', quantity: 1, choiceIds: [] }; // 70, bar
const porkRice = { menuItemId: 'item-pork-rice', quantity: 1, choiceIds: [] }; // 45, wok

/** A seeded restaurant. The service charge is off unless asked for, to keep the sums simple. */
async function demoRestaurant({ serviceChargeRate = 0 } = {}) {
  const storage = memoryStorage();
  let actor: DemoActor = everyRole;
  const staff = createDemoRepository(storage, () => actor);
  const customer = createDemoCustomerRepository(storage);
  await staff.seedCatalog();
  await staff.changeCatalog([
    { type: 'settings/save', settings: { ...sampleCatalog.settings, serviceChargeRate } },
  ]);
  const catalog = await staff.getCatalog();
  const table = catalog.tables.find((candidate) => candidate.id === 'table-B1');
  assert.ok(table?.qrToken);
  let orders = 0;
  return {
    staff,
    customer,
    table,
    tableToken: table.qrToken,
    /** Acts as someone with only these roles until called again. */
    as(...roles: Role[]) {
      actor = roles.length ? demoActor(roles) : everyRole;
    },
    async open(tableId = table.id, guestCount = 4) {
      const checkId = `check-${tableId}-${Date.now()}-${Math.random()}`;
      await staff.openTable({ checkId, tableId, guestCount });
      return checkId;
    },
    async send(checkId: string, items: OrderItemInput[], expectedTotal: number) {
      orders += 1;
      const orderId = `order-${orders}`;
      await staff.sendOrder({ orderId, checkId, items, expectedTotal });
      return orderId;
    },
    async state() {
      return staff.loadLiveState();
    },
  };
}

const checkOf = (state: LiveState, checkId: string): GuestCheck => {
  const check = state.checks[checkId];
  assert.ok(check);
  return check;
};

test('a table goes from empty to dining, is paid, waits to be cleaned, then is empty again', async () => {
  const restaurant = await demoRestaurant();
  const { staff, table } = restaurant;
  assert.equal(tableState(await restaurant.state(), table.id), 'EMPTY');

  const checkId = await restaurant.open();
  assert.equal(tableState(await restaurant.state(), table.id), 'DINING');

  await restaurant.send(checkId, [greens, tofu], 90);
  let state = await restaurant.state();
  assert.equal(checkOf(state, checkId).billTotal, 90, 'sent without payment, and billed');
  assert.equal(Object.keys(state.tickets).length, 2);

  await assert.rejects(staff.markTableCleaned(table.id), rejection('TABLE_NOT_CLEARABLE'));
  await staff.recordPayment({ paymentId: 'p1', checkId, method: 'CASH', kind: 'BALANCE', expectedAmount: 90 });
  state = await restaurant.state();
  assert.equal(checkOf(state, checkId).status, 'CLOSED');
  assert.equal(tableState(state, table.id), 'CLEANING');
  await assert.rejects(restaurant.send(checkId, [greens], 40), rejection('CHECK_CLOSED'));

  await staff.markTableCleaned(table.id);
  assert.equal(tableState(await restaurant.state(), table.id), 'EMPTY');
});

test('opening an occupied table is refused, but retrying the same opening is not', async () => {
  const { staff, table } = await demoRestaurant();
  const input = { checkId: 'c1', tableId: table.id, guestCount: 2 };
  await staff.openTable(input);
  await staff.openTable(input);
  await assert.rejects(staff.openTable({ ...input, checkId: 'c2' }), rejection('TABLE_OCCUPIED'));
  await assert.rejects(staff.openTable({ ...input, tableId: 'table-A1', checkId: 'c3', guestCount: 0 }), rejection('INVALID_GUESTS'));
  assert.equal((await staff.loadLiveState()).seatings[table.id].checkId, 'c1');
});

test('a party that orders nothing can leave, but a bill with orders cannot be cancelled', async () => {
  const restaurant = await demoRestaurant();
  const { staff, table } = restaurant;
  const checkId = await restaurant.open();
  await staff.cancelTable(checkId);
  let state = await restaurant.state();
  assert.equal(tableState(state, table.id), 'EMPTY', 'nothing to clean');
  assert.equal(checkOf(state, checkId).status, 'CANCELLED');

  const second = await restaurant.open();
  await restaurant.send(second, [greens], 40);
  await assert.rejects(staff.cancelTable(second), rejection('CHECK_HAS_ORDERS'));
  state = await restaurant.state();
  assert.equal(tableState(state, table.id), 'DINING');
});

test('a round is split into one ticket per station, and each round is numbered', async () => {
  const restaurant = await demoRestaurant();
  const checkId = await restaurant.open();
  const first = await restaurant.send(checkId, [greens, tofu, beer, porkRice], 40 + 50 + 70 + 45);
  let state = await restaurant.state();
  const tickets = Object.values(state.tickets);
  assert.deepEqual(
    tickets.map((ticket) => ticket.stationId).sort(),
    ['station-bar', 'station-cold', 'station-noodle', 'station-wok'],
  );
  assert.ok(tickets.every((ticket) => ticket.orderId === first && ticket.round === 1));
  assert.deepEqual(
    ticketsAtStation(state, 'station-bar', ['NEW']).flatMap((ticket) => ticket.lines.map((line) => line.name)),
    ['台灣啤酒'],
    'each station sees only its own',
  );

  await restaurant.send(checkId, [beer], 70);
  state = await restaurant.state();
  const rounds = roundsForCheck(state, checkId);
  assert.deepEqual(rounds.map((round) => round.round), [1, 2]);
  assert.equal(checkOf(state, checkId).billTotal, 275);
});

test('sending the same order twice bills it once', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  const input = { orderId: 'o1', checkId, items: [greens, beer], expectedTotal: 110 };
  await staff.sendOrder(input);
  await staff.sendOrder(input);
  const state = await restaurant.state();
  assert.equal(Object.keys(state.tickets).length, 2);
  assert.equal(checkOf(state, checkId).billTotal, 110);
  assert.equal(checkOf(state, checkId).rounds, 1);
  await assert.rejects(
    staff.sendOrder({ ...input, orderId: 'o2', expectedTotal: 100 }),
    rejection('PRICE_CHANGED'),
    'the server sets the price',
  );
});

test('a customer’s QR order waits for a server, who sends it to the table’s bill', async () => {
  const restaurant = await demoRestaurant();
  const { staff, customer, table, tableToken } = restaurant;

  const placed = await customer.placeOrder({ orderId: 'q1', tableToken, items: [greens], expectedTotal: 40 });
  assert.equal(placed.status, 'PENDING');
  let state = await restaurant.state();
  assert.deepEqual(state.tickets, {}, 'nothing reaches the kitchen');
  assert.deepEqual(pendingOrders(state, Date.now()).map((order) => order.id), ['q1']);
  assert.equal(tableState(state, table.id), 'EMPTY', 'a QR order does not open the table');

  // An old link left by the last party must not bill an empty table.
  await assert.rejects(staff.confirmCustomerOrder('q1'), rejection('TABLE_NOT_OPEN'));

  const checkId = await restaurant.open();
  await staff.confirmCustomerOrder('q1');
  await staff.confirmCustomerOrder('q1');
  state = await restaurant.state();
  assert.equal(checkOf(state, checkId).billTotal, 40, 'confirming twice bills once');
  assert.equal(state.tickets[ticketIdFor('q1', 'station-noodle')].status, 'NEW');
  assert.deepEqual(pendingOrders(state, Date.now()), []);
  const sent = await customer.getOrder('q1');
  assert.equal(sent?.status, 'SENT');
  assert.equal(sent?.kitchenStatus, 'NEW');

  await customer.placeOrder({ orderId: 'q2', tableToken, items: [greens], expectedTotal: 40 });
  await staff.rejectCustomerOrder('q2');
  assert.equal((await customer.getOrder('q2'))?.status, 'REJECTED');
  await assert.rejects(staff.confirmCustomerOrder('q2'), rejection('ORDER_DECIDED'));
  assert.equal(checkOf(await restaurant.state(), checkId).billTotal, 40);
});

test('an unconfirmed QR order expires and cannot be sent', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T10:00:00.000Z') });
  const restaurant = await demoRestaurant();
  const { staff, customer, tableToken } = restaurant;
  await restaurant.open();
  await customer.placeOrder({ orderId: 'q1', tableToken, items: [greens], expectedTotal: 40 });
  context.mock.timers.setTime(Date.parse('2026-11-04T10:15:00.000Z'));
  assert.equal((await customer.getOrder('q1'))?.status, 'EXPIRED');
  await assert.rejects(staff.confirmCustomerOrder('q1'), rejection('ORDER_EXPIRED'));
  assert.equal(effectiveOrderStatus({ status: 'SENT', expiresAt: '2026-11-04T10:00:00.000Z' }, Date.now()), 'SENT');
});

test('one QR link cannot flood the servers’ list', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T10:00:00.000Z') });
  const { customer, tableToken } = await demoRestaurant();
  const place = (orderId: string) =>
    customer.placeOrder({ orderId, tableToken, items: [greens], expectedTotal: 40 });
  for (let index = 0; index < MAX_PENDING_ORDERS_PER_TABLE; index += 1) await place(`q${index}`);
  await assert.rejects(place('one-too-many'), rejection('TOO_MANY_PENDING'));
  context.mock.timers.setTime(Date.parse('2026-11-04T10:16:00.000Z'));
  await place('after-expiry');
});

test('a round is ready to serve only when every station has finished it', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens, beer], 110);
  const noodle = ticketIdFor(orderId, 'station-noodle');
  const bar = ticketIdFor(orderId, 'station-bar');

  restaurant.as('KITCHEN');
  await staff.setTicketStatus(bar, 'READY');
  let state = await restaurant.state();
  assert.deepEqual(readyRounds(state), [], 'the drink waits for the food');
  assert.equal(roundStatus(state, roundsForCheck(state, checkId)[0].tickets), 'NEW');

  await staff.setTicketStatus(noodle, 'READY');
  state = await restaurant.state();
  const [ready] = readyRounds(state);
  assert.equal(ready.orderId, orderId);

  restaurant.as('SERVER');
  await staff.serveTickets(ready.tickets.map((ticket) => ticket.id));
  state = await restaurant.state();
  assert.equal(roundStatus(state, roundsForCheck(state, checkId)[0].tickets), 'SERVED');
  assert.deepEqual(readyRounds(state), []);
});

test('a server’s cancellation waits for a supervisor, and the kitchen sees it meanwhile', async () => {
  const restaurant = await demoRestaurant();
  const { staff, customer, tableToken } = restaurant;
  const checkId = await restaurant.open();
  await customer.placeOrder({ orderId: 'q1', tableToken, items: [greens, beer], expectedTotal: 110 });
  await staff.confirmCustomerOrder('q1');
  const ticketId = ticketIdFor('q1', 'station-noodle');
  const [line] = (await restaurant.state()).tickets[ticketId].lines;

  restaurant.as('SERVER');
  await staff.requestVoid({ ticketId, lineId: line.id, reason: '客人取消' });
  let state = await restaurant.state();
  assert.equal(state.voids[voidId(ticketId, line.id)].status, 'REQUESTED');
  assert.equal(checkOf(state, checkId).billTotal, 110, 'still billed until approved');
  assert.equal(voidRequests(state).length, 1);
  await assert.rejects(staff.decideVoid(voidId(ticketId, line.id), true), rejection('FORBIDDEN'));
  await assert.rejects(
    staff.requestVoid({ ticketId, lineId: line.id, reason: '點錯' }),
    rejection('VOID_EXISTS'),
    'one request per line',
  );

  restaurant.as('SUPERVISOR');
  await staff.decideVoid(voidId(ticketId, line.id), false);
  restaurant.as('SERVER');
  await staff.requestVoid({ ticketId, lineId: line.id, reason: '點錯' });
  restaurant.as('SUPERVISOR');
  await staff.decideVoid(voidId(ticketId, line.id), true);
  state = await restaurant.state();
  const lineVoid = state.voids[voidId(ticketId, line.id)];
  assert.equal(lineVoid.status, 'APPROVED');
  assert.match(lineVoid.requestedBy, /服務員/);
  assert.match(lineVoid.decidedBy ?? '', /主管/);
  assert.equal(checkOf(state, checkId).billTotal, 70);
  assert.ok(isFullyVoided(state, state.tickets[ticketId]), 'the station has nothing left to cook');
  assert.deepEqual((await customer.getOrder('q1'))?.voidedLineIds, [line.id]);
  await assert.rejects(staff.decideVoid(voidId(ticketId, line.id), false), rejection('VOID_DECIDED'));
});

test('a supervisor cancels at once, but nothing is cancelled once payment has started', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens, beer, tofu], 160);
  const state = await restaurant.state();
  const [greensLine] = state.tickets[ticketIdFor(orderId, 'station-noodle')].lines;
  const [beerLine] = state.tickets[ticketIdFor(orderId, 'station-bar')].lines;

  restaurant.as('SUPERVISOR');
  await staff.requestVoid({ ticketId: ticketIdFor(orderId, 'station-noodle'), lineId: greensLine.id, reason: '缺料' });
  assert.equal(checkOf(await restaurant.state(), checkId).billTotal, 120);

  restaurant.as('CASHIER');
  await staff.recordPayment({ paymentId: 'p1', checkId, method: 'CASH', kind: 'AMOUNT', amount: 20, expectedAmount: 20 });
  restaurant.as('SUPERVISOR');
  await assert.rejects(
    staff.requestVoid({ ticketId: ticketIdFor(orderId, 'station-bar'), lineId: beerLine.id, reason: '點錯' }),
    rejection('CHECK_PAYING'),
  );
});

test('a bill can be split by item, with each line paid once', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens, beer], 110);
  const state = await restaurant.state();
  const greensKey = lineKey(ticketIdFor(orderId, 'station-noodle'), state.tickets[ticketIdFor(orderId, 'station-noodle')].lines[0].id);
  const beerKey = lineKey(ticketIdFor(orderId, 'station-bar'), state.tickets[ticketIdFor(orderId, 'station-bar')].lines[0].id);

  await staff.recordPayment({ paymentId: 'p1', checkId, method: 'CARD', kind: 'LINES', lineKeys: [beerKey], expectedAmount: 70 });
  await assert.rejects(
    staff.recordPayment({ paymentId: 'p2', checkId, method: 'CASH', kind: 'LINES', lineKeys: [beerKey], expectedAmount: 70 }),
    rejection('LINE_ALREADY_PAID'),
  );
  await assert.rejects(
    staff.recordPayment({ paymentId: 'p3', checkId, method: 'CASH', kind: 'LINES', lineKeys: ['nope#x'], expectedAmount: 0 }),
    rejection('LINE_NOT_FOUND'),
  );
  await staff.recordPayment({ paymentId: 'p4', checkId, method: 'CASH', kind: 'LINES', lineKeys: [greensKey], expectedAmount: 40 });
  const check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.status, 'CLOSED');
  assert.deepEqual(check.paidLineKeys, [beerKey, greensKey]);
});

test('a bill can be split equally, with the odd dollar on the first shares', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  await restaurant.send(checkId, [greens, beer, tofu], 160);
  const amounts: number[] = [];
  for (let parts = 3; parts >= 1; parts -= 1) {
    const state = await restaurant.state();
    const check = checkOf(state, checkId);
    if (parts < 3) assert.equal(sharesLeft(Object.values(state.payments)), parts, 'the split carries on');
    const { amount } = paymentAmount(check, { kind: 'SHARE', parts }, billFor(state, check));
    amounts.push(amount);
    await staff.recordPayment({ paymentId: `p${parts}`, checkId, method: 'CASH', kind: 'SHARE', parts, expectedAmount: amount });
  }
  assert.deepEqual(amounts, [54, 53, 53]);
  assert.equal(checkOf(await restaurant.state(), checkId).status, 'CLOSED');
});

test('a bill can be paid in parts, and the server checks every amount', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  await restaurant.send(checkId, [greens, beer], 110);
  const pay = (paymentId: string, request: Record<string, unknown>, expectedAmount: number) =>
    staff.recordPayment({ paymentId, checkId, method: 'CASH', kind: 'AMOUNT', expectedAmount, ...request });

  await assert.rejects(pay('p1', { amount: 111 }, 111), rejection('INVALID_PAYMENT'), 'no overpaying');
  await assert.rejects(pay('p1', { amount: 0 }, 0), rejection('INVALID_PAYMENT'));
  await assert.rejects(pay('p1', { kind: 'BALANCE' }, 100), rejection('AMOUNT_CHANGED'), 'a stale screen');
  await pay('p1', { amount: 60 }, 60);
  await pay('p1', { amount: 60 }, 60);
  let check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.paidTotal, 60, 'a retried payment is taken once');
  assert.equal(balanceOf(check), 50);
  await staff.recordPayment({ paymentId: 'p2', checkId, method: 'CARD', kind: 'BALANCE', expectedAmount: 50 });
  check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.status, 'CLOSED');
  await assert.rejects(pay('p3', { amount: 1 }, 1), rejection('CHECK_CLOSED'));
});

test('a bill whose lines were all cancelled is ended without payment', async () => {
  const restaurant = await demoRestaurant();
  const { staff, table } = restaurant;
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens], 40);
  const ticketId = ticketIdFor(orderId, 'station-noodle');
  const [line] = (await restaurant.state()).tickets[ticketId].lines;
  await assert.rejects(staff.closeCheck(checkId), rejection('BALANCE_DUE'));
  await staff.requestVoid({ ticketId, lineId: line.id, reason: '缺料' });
  await assert.rejects(
    staff.recordPayment({ paymentId: 'p1', checkId, method: 'CASH', kind: 'BALANCE', expectedAmount: 0 }),
    rejection('NOTHING_TO_PAY'),
  );
  await staff.closeCheck(checkId);
  assert.equal(tableState(await restaurant.state(), table.id), 'CLEANING');
});

test('the waitlist suggests the closest fitting empty table and seats the party there', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  await restaurant.open('table-C1', 6);
  await staff.addToWaitlist({ id: 'w1', name: ' 王先生 ', partySize: 5, phone: '0912-345-678' });
  await staff.addToWaitlist({ id: 'w1', name: '王先生', partySize: 5 });
  await assert.rejects(staff.addToWaitlist({ id: 'w2', name: '', partySize: 2 }), rejection('WAITLIST_INVALID'));
  await assert.rejects(staff.addToWaitlist({ id: 'w2', name: '李', partySize: 2, phone: 'call me' }), rejection('WAITLIST_INVALID'));

  let state = await restaurant.state();
  const catalog = await staff.getCatalog();
  assert.deepEqual(
    suggestTables(catalog, state, 5).map((table) => table.name),
    ['C2', '包廂'],
    'the smallest table that fits comes first, and occupied tables are left out',
  );

  await staff.openTable({ checkId: 'c-w1', tableId: 'table-C2', guestCount: 5, waitlistEntryId: 'w1' });
  state = await restaurant.state();
  assert.equal(state.waitlist.w1.status, 'SEATED');
  assert.equal(state.waitlist.w1.name, '王先生');
  assert.equal(checkOf(state, 'c-w1').partyName, '王先生');
  assert.equal(tableState(state, 'table-C2'), 'DINING');
  await assert.rejects(
    staff.openTable({ checkId: 'c-again', tableId: 'table-A1', guestCount: 5, waitlistEntryId: 'w1' }),
    rejection('WAITLIST_DECIDED'),
  );

  await staff.addToWaitlist({ id: 'w3', name: '陳小姐', partySize: 2 });
  await staff.cancelWaitlistEntry('w3');
  assert.equal((await restaurant.state()).waitlist.w3.status, 'CANCELLED');
});

test('each role can do only its own work', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens], 40);
  const ticketId = ticketIdFor(orderId, 'station-noodle');

  restaurant.as('KITCHEN');
  await assert.rejects(restaurant.send(checkId, [greens], 40), rejection('FORBIDDEN'));
  await assert.rejects(staff.openTable({ checkId: 'x', tableId: 'table-A1', guestCount: 2 }), rejection('FORBIDDEN'));
  await staff.setTicketStatus(ticketId, 'PREPARING');
  await staff.setItemAvailable('item-greens', false);

  restaurant.as('CASHIER');
  await assert.rejects(restaurant.send(checkId, [beer], 70), rejection('FORBIDDEN'));
  await assert.rejects(staff.setTicketStatus(ticketId, 'READY'), rejection('FORBIDDEN'));
  await staff.addToWaitlist({ id: 'w1', name: '林', partySize: 2 });

  restaurant.as('SERVER');
  await assert.rejects(
    staff.recordPayment({ paymentId: 'p1', checkId, method: 'CASH', kind: 'BALANCE', expectedAmount: 40 }),
    rejection('FORBIDDEN'),
  );
  await assert.rejects(staff.getDailyRecords(businessDate(Date.now())), rejection('FORBIDDEN'));
  await assert.rejects(staff.changeCatalog([]), rejection('FORBIDDEN'));
  await staff.requestBill(checkId);
  assert.ok(checkOf(await restaurant.state(), checkId).billRequestedAt);

  assert.ok(can(['SERVER', 'CASHIER'], 'checkout'), 'an account may hold several roles');
  assert.ok(!can([], 'order'));
});

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

test('an older copy of a record never replaces a newer one', () => {
  const check = (updatedAt: string, billTotal: number): GuestCheck => ({
    id: 'c1',
    tableId: 't1',
    tableName: 'A1',
    status: 'OPEN',
    openedAt: '2026-11-04T10:00:00.000Z',
    rounds: 0,
    ticketIds: [],
    discounts: [],
    serviceChargeRate: 0,
    itemsTotal: billTotal,
    discountTotal: 0,
    serviceCharge: 0,
    billTotal,
    paidTotal: 0,
    paidLineKeys: [],
    updatedAt,
  });
  let state = applyChange(emptyLiveState, { checks: [check('2026-11-04T10:00:02.000Z', 200)] });
  state = applyChange(state, { checks: [check('2026-11-04T10:00:01.000Z', 100)] });
  assert.equal(state.checks.c1.billTotal, 200);
  state = applyChange(state, { checks: [check('2026-11-04T10:00:03.000Z', 300)] });
  assert.equal(state.checks.c1.billTotal, 300);
});

test('clearing a table only clears the party it was for', () => {
  let state = applyChange(emptyLiveState, { seatings: [{ tableId: 't1', checkId: 'new-party' }] });
  state = applyChange(state, { clearedSeatings: [{ tableId: 't1', checkId: 'old-party' }] });
  assert.equal(state.seatings.t1.checkId, 'new-party', 'a late notice about the last party changes nothing');
  state = applyChange(state, { clearedSeatings: [{ tableId: 't1', checkId: 'new-party' }] });
  assert.equal(state.seatings.t1, undefined);
});

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

test('an edited item keeps its sold out flag, and a new one starts available', async () => {
  const { staff, customer, tableToken } = await demoRestaurant();
  const greensItem = (await staff.getCatalog()).items.find((candidate) => candidate.id === 'item-greens');
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
  const edited = items.find((candidate) => candidate.id === 'item-greens');
  assert.equal(edited?.price, 45);
  assert.equal(edited?.available, false, 'saving does not undo sold out');
  assert.equal(items.find((candidate) => candidate.id === 'item-new')?.available, null);

  const order = await customer.placeOrder({
    orderId: 'q1',
    tableToken,
    items: [{ menuItemId: 'item-new', quantity: 1, choiceIds: [] }],
    expectedTotal: 40,
  });
  assert.equal(order.lines[0].name, '燙地瓜葉');
});

test('editing a table keeps its QR code working', async () => {
  const { staff, customer, table, tableToken } = await demoRestaurant();
  await staff.changeCatalog([
    { type: 'table/save', table: { ...table, name: '窗邊 1', zone: '二樓', qrToken: 'stale' }, isNew: false },
  ]);
  assert.deepEqual(await customer.getTable(tableToken), { name: '窗邊 1' });
  assert.equal((await staff.getCatalog()).tables.find((candidate) => candidate.id === table.id)?.zone, '二樓');

  await staff.changeCatalog([{ type: 'table/delete', id: table.id }]);
  assert.equal(await customer.getTable(tableToken), null, 'a deleted table stops taking orders');
});

test('stations can be added, renamed and deleted', () => {
  let catalog = applyCatalogChange(sampleCatalog, {
    type: 'station/save',
    station: { id: 'station-grill', name: '燒烤', sortOrder: -1 },
    isNew: true,
  });
  assert.equal(catalog.stations[0].name, '燒烤', 'kept in sort order');
  catalog = applyCatalogChange(catalog, {
    type: 'station/save',
    station: { id: 'station-grill', name: '炭烤', sortOrder: -1 },
    isNew: false,
  });
  assert.equal(catalog.stations[0].name, '炭烤');
  catalog = applyCatalogChange(catalog, { type: 'station/delete', id: 'station-grill' });
  assert.equal(catalog.stations.length, sampleCatalog.stations.length);
});

test('a deleted category or item disappears from the catalog', () => {
  let catalog = applyCatalogChange(sampleCatalog, { type: 'item/delete', id: 'item-greens' });
  assert.ok(!catalog.items.some((candidate) => candidate.id === 'item-greens'));
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
  assert.equal(moveBy(records, 'a', -1), undefined);
  assert.equal(moveBy(records, 'c', 1), undefined);
  assert.deepEqual(moveBy([{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 1 }], 'b', -1), [
    { id: 'b', sortOrder: 0 },
  ]);
  assert.equal(nextSortOrder(records), 40);
  assert.equal(nextSortOrder([]), 10);
});

test('an item that cannot be ordered is not saved', () => {
  const withOptions = sampleCatalog.items.find((candidate) => candidate.optionGroups.length > 0);
  assert.ok(withOptions);
  assert.deepEqual(menuItemProblems(withOptions), []);
  assert.deepEqual(menuItemProblems({ ...withOptions, name: ' ', price: 1.5 }), [
    '品名必填，最多 40 字',
    '價格要是 0 到 100000 的整數',
  ]);
  const [group] = withOptions.optionGroups;
  assert.deepEqual(menuItemProblems({ ...withOptions, optionGroups: [{ ...group, choices: [] }] }), [
    `「${group.name}」至少要有一個選項`,
  ]);
});

// ---------------------------------------------------------------------------
// The daily report
// ---------------------------------------------------------------------------

test('a business day runs midnight to midnight in Taiwan', () => {
  assert.deepEqual(businessDay('2026-11-06'), {
    start: '2026-11-05T16:00:00.000Z',
    end: '2026-11-06T16:00:00.000Z',
  });
  assert.equal(businessDate('2026-11-05T15:59:59.999Z'), '2026-11-05');
  assert.equal(businessDate('2026-11-05T16:00:00.000Z'), '2026-11-06');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.ok(isBusinessDate('2026-02-28'));
  assert.ok(!isBusinessDate('2026-02-30'));
  assert.throws(() => businessDay('yesterday'));
});

test('the daily report adds up takings by method, and items of the bills paid off', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const first = await restaurant.open('table-A1', 2);
  const orderId = await restaurant.send(first, [greens, beer], 110);
  const ticketId = ticketIdFor(orderId, 'station-noodle');
  const [line] = (await restaurant.state()).tickets[ticketId].lines;
  await staff.requestVoid({ ticketId, lineId: line.id, reason: '缺料' });
  await staff.recordPayment({ paymentId: 'p1', checkId: first, method: 'CASH', kind: 'AMOUNT', amount: 20, expectedAmount: 20 });
  await staff.recordPayment({ paymentId: 'p2', checkId: first, method: 'CARD', kind: 'BALANCE', expectedAmount: 50 });

  const second = await restaurant.open('table-A2', 2);
  await restaurant.send(second, [beer], 70);
  await staff.recordPayment({ paymentId: 'p3', checkId: second, method: 'CASH', kind: 'AMOUNT', amount: 30, expectedAmount: 30 });

  const report = dailyReport(await staff.getDailyRecords(businessDate(Date.now())));
  assert.equal(report.received, 100, 'every payment taken today');
  assert.deepEqual(report.byMethod, { CASH: { count: 2, amount: 50 }, CARD: { count: 1, amount: 50 } });
  assert.equal(report.checks, 1, 'only the bill paid off');
  assert.equal(report.guests, 2);
  assert.equal(report.billed, 70);
  assert.deepEqual(
    report.items.map(({ name, quantity, voidedQuantity }) => [name, quantity, voidedQuantity]),
    [
      ['台灣啤酒', 1, 0],
      ['燙青菜', 0, 1],
    ],
  );
  assert.equal(report.voids[0].reason, '缺料');
});

// ---------------------------------------------------------------------------
// Phase 2: service charge, discounts, invoices, bookings, kitchen timing
// ---------------------------------------------------------------------------

const ticketOf = (id: string, lines: [string, number, boolean?][]): KitchenTicket => ({
  id,
  orderId: id,
  checkId: 'c1',
  tableName: 'A1',
  round: 1,
  status: 'NEW',
  sentAt: '2026-11-04T10:00:00.000Z',
  lines: lines.map(([lineId, unitPrice, noServiceCharge]) => ({
    id: lineId,
    menuItemId: lineId,
    name: lineId,
    quantity: 1,
    unitPrice,
    options: [],
    noServiceCharge,
  })),
  updatedAt: '2026-11-04T10:00:00.000Z',
});
const approved = (discount: Omit<Discount, 'status' | 'reason' | 'requestedBy' | 'requestedAt'>): Discount => ({
  ...discount,
  status: 'APPROVED',
  reason: '熟客',
  requestedBy: 'a',
  requestedAt: '2026-11-04T10:00:00.000Z',
});

test('the service charge is taken on the bill after discounts, leaving out exempt items', () => {
  const tickets = [ticketOf('t1', [['steak', 1000], ['wine', 500, true], ['salad', 200]])];
  const noDiscounts = billOf({ discounts: [], serviceChargeRate: 10 }, tickets, {});
  assert.equal(noDiscounts.itemsTotal, 1700);
  assert.equal(noDiscounts.serviceCharge, 120, 'the wine carries none');
  assert.equal(noDiscounts.total, 1820);

  const discounts = [
    approved({ id: 'd1', kind: 'LINE_COMP', value: 0, lineKey: lineKey('t1', 'salad') }),
    approved({ id: 'd2', kind: 'CHECK_PERCENT', value: 10 }),
  ];
  const bill = billOf({ discounts, serviceChargeRate: 10 }, tickets, {});
  assert.equal(bill.lineDiscounts, 200, 'the salad is on the house');
  assert.equal(bill.checkDiscount, 150, '9 折 of what is left');
  assert.equal(bill.serviceBase, 900, 'the steak after 9 折');
  assert.equal(bill.serviceCharge, 90);
  assert.equal(bill.total, 1500 - 150 + 90);
  const payable = bill.lines.reduce((sum, line) => sum + line.payable, 0);
  assert.ok(Math.abs(payable - bill.total) <= bill.lines.length, 'shares by item add up to the bill, give or take rounding');

  const amountOff = billOf(
    { discounts: [approved({ id: 'd3', kind: 'LINE_AMOUNT', value: 300, lineKey: lineKey('t1', 'steak') })], serviceChargeRate: 0 },
    tickets,
    {},
  );
  assert.equal(amountOff.total, 1400);
  const voided = billOf(
    { discounts, serviceChargeRate: 0 },
    tickets,
    { [voidId('t1', 'salad')]: { status: 'APPROVED' } as never },
  );
  assert.equal(voided.lineDiscounts, 0, 'a cancelled line takes its discount with it');
});

test('a check keeps the service charge it was opened with', async () => {
  const restaurant = await demoRestaurant({ serviceChargeRate: 10 });
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  await restaurant.send(checkId, [greens, beer], 110);
  let check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.serviceCharge, 4, '10% of the greens; beer is exempt in the sample menu');
  assert.equal(check.billTotal, 114);

  await staff.changeCatalog([{ type: 'settings/save', settings: { ...sampleCatalog.settings, serviceChargeRate: 0 } }]);
  await restaurant.send(checkId, [greens], 40);
  check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.serviceChargeRate, 10);
  assert.equal(check.billTotal, 80 + 8 + 70);
  const other = await restaurant.open('table-A1', 2);
  assert.equal(checkOf(await restaurant.state(), other).serviceChargeRate, 0);
});

test('a server’s discount waits for a supervisor; a supervisor’s applies at once', async () => {
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens, tofu], 90);
  const tofuKey = lineKey(ticketIdFor(orderId, 'station-cold'), (await restaurant.state()).tickets[ticketIdFor(orderId, 'station-cold')].lines[0].id);

  restaurant.as('SERVER');
  await staff.requestDiscount(checkId, { id: 'd1', kind: 'LINE_COMP', value: 0, lineKey: tofuKey, reason: '餐點問題' });
  await staff.requestDiscount(checkId, { id: 'd1', kind: 'LINE_COMP', value: 0, lineKey: tofuKey, reason: '餐點問題' });
  let check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.discounts.length, 1, 'a retry adds nothing');
  assert.equal(check.billTotal, 90, 'not until approved');
  await assert.rejects(
    staff.requestDiscount(checkId, { id: 'd2', kind: 'LINE_PERCENT', value: 10, lineKey: tofuKey, reason: '熟客' }),
    rejection('DISCOUNT_EXISTS'),
  );
  await assert.rejects(staff.decideDiscount(checkId, 'd1', true), rejection('FORBIDDEN'));

  restaurant.as('SUPERVISOR');
  await staff.decideDiscount(checkId, 'd1', true);
  check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.billTotal, 40);
  assert.equal(check.discountTotal, 50);
  assert.match(check.discounts[0].decidedBy ?? '', /主管/);

  await staff.requestDiscount(checkId, { id: 'd3', kind: 'CHECK_AMOUNT', value: 100, reason: '店內活動' });
  check = checkOf(await restaurant.state(), checkId);
  assert.equal(check.billTotal, 0, 'an amount off never takes the bill below zero');
  await staff.removeDiscount(checkId, 'd3');
  assert.equal(checkOf(await restaurant.state(), checkId).billTotal, 40);
  await assert.rejects(
    staff.requestDiscount(checkId, { id: 'd4', kind: 'CHECK_PERCENT', value: 0, reason: '熟客' }),
    rejection('INVALID_DISCOUNT'),
  );

  restaurant.as('CASHIER');
  await staff.recordPayment({ paymentId: 'p1', checkId, method: 'CASH', kind: 'AMOUNT', amount: 10, expectedAmount: 10 });
  await assert.rejects(
    staff.requestDiscount(checkId, { id: 'd5', kind: 'CHECK_PERCENT', value: 10, reason: '熟客' }),
    rejection('CHECK_PAYING'),
  );
});

test('splitting by item charges each line its share, and the last lines pay what is left', async () => {
  const restaurant = await demoRestaurant({ serviceChargeRate: 10 });
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  await restaurant.send(checkId, [greens, tofu, porkRice], 135);
  await staff.requestDiscount(checkId, { id: 'd1', kind: 'CHECK_PERCENT', value: 15, reason: '熟客' });
  const state = await restaurant.state();
  const check = checkOf(state, checkId);
  const bill = billFor(state, check);
  assert.equal(check.billTotal, 135 - 20 + 12, "10% of 115 rounds up");
  const [first, ...rest] = bill.lines;
  await staff.recordPayment({
    paymentId: 'p1',
    checkId,
    method: 'CASH',
    kind: 'LINES',
    lineKeys: [first.key],
    expectedAmount: first.payable,
  });
  const after = checkOf(await restaurant.state(), checkId);
  await staff.recordPayment({
    paymentId: 'p2',
    checkId,
    method: 'CARD',
    kind: 'LINES',
    lineKeys: rest.map((line) => line.key),
    expectedAmount: balanceOf(after),
  });
  assert.equal(checkOf(await restaurant.state(), checkId).status, 'CLOSED');
});

test('invoice details are checked before a payment is taken', async () => {
  assert.ok(isTaxId('22099131'));
  assert.ok(!isTaxId('22099132'));
  assert.ok(isTaxId('10458575'), 'a seventh digit of 7 may count either way');
  assert.deepEqual(checkInvoice({ carrierType: 'MOBILE', carrierId: ' /abc+123 ', buyerTaxId: '22099131' }), {
    carrierType: 'MOBILE',
    carrierId: '/ABC+123',
    buyerTaxId: '22099131',
    donationCode: null,
  });
  for (const invalid of [
    { carrierType: 'MOBILE', carrierId: 'ABC1234' },
    { carrierType: 'CERTIFICATE', carrierId: 'AB123' },
    { carrierType: 'NONE', carrierId: '/ABC1234' },
    { carrierType: 'NONE', buyerTaxId: '12345678' },
    { carrierType: 'NONE', donationCode: '12' },
    { carrierType: 'NONE', donationCode: '919', buyerTaxId: '22099131' },
    { carrierType: 'MOBILE', carrierId: '/ABC1234', donationCode: '919' },
  ] as const) {
    assert.throws(() => checkInvoice(invalid), rejection('INVALID_INVOICE'), JSON.stringify(invalid));
  }

  const restaurant = await demoRestaurant();
  const checkId = await restaurant.open();
  await restaurant.send(checkId, [greens], 40);
  const pay = (invoice: Parameters<typeof checkInvoice>[0]) =>
    restaurant.staff.recordPayment({ paymentId: 'p1', checkId, method: 'CARD', kind: 'BALANCE', expectedAmount: 40, invoice });
  await assert.rejects(pay({ carrierType: 'MOBILE', carrierId: 'nope' }), rejection('INVALID_INVOICE'));
  await pay({ carrierType: 'NONE', donationCode: '919' });
  const [payment] = Object.values((await restaurant.state()).payments);
  assert.equal(payment.invoice.donationCode, '919');
  assert.equal(payment.invoiceNumber, null, 'issued once a provider is connected');
});

test('bookings show on the day they are for, and can be marked as not coming', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-06T09:00:00.000Z') }); // 17:00 in Taiwan
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  await staff.addToWaitlist({ id: 'walk-in', name: '陳', partySize: 2 });
  await staff.addToWaitlist({ id: 'tonight', name: '王', partySize: 4, reservedFor: '2026-11-06T11:00:00.000Z', note: '兒童椅' });
  await staff.addToWaitlist({ id: 'tomorrow', name: '林', partySize: 6, reservedFor: '2026-11-07T11:00:00.000Z' });
  await assert.rejects(
    staff.addToWaitlist({ id: 'next-year', name: '李', partySize: 2, reservedFor: '2027-11-06T11:00:00.000Z' }),
    rejection('WAITLIST_INVALID'),
  );
  let state = await restaurant.state();
  assert.deepEqual(waitingParties(state).map((entry) => entry.id), ['walk-in', 'tonight']);
  assert.deepEqual(reservationsOn(state, '2026-11-07').map((entry) => entry.id), ['tomorrow']);

  await staff.openTable({ checkId: 'c1', tableId: 'table-B2', guestCount: 4, waitlistEntryId: 'tonight' });
  context.mock.timers.setTime(Date.parse('2026-11-07T12:00:00.000Z'));
  await staff.cancelWaitlistEntry('tomorrow', true);
  state = await restaurant.state();
  assert.equal(state.waitlist.tonight.status, 'SEATED');
  assert.equal(state.waitlist.tomorrow.status, 'NO_SHOW');
});

test('the kitchen report shows where each station spends its time', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-06T10:00:00.000Z') });
  const restaurant = await demoRestaurant();
  const { staff } = restaurant;
  const at = (minute: number) => context.mock.timers.setTime(Date.parse('2026-11-06T10:00:00.000Z') + minute * 60_000);
  const checkId = await restaurant.open();
  const orderId = await restaurant.send(checkId, [greens, beer], 110);
  const noodle = ticketIdFor(orderId, 'station-noodle');
  const bar = ticketIdFor(orderId, 'station-bar');
  at(2);
  await staff.setTicketStatus(bar, 'PREPARING');
  at(3);
  await staff.setTicketStatus(bar, 'READY');
  at(10);
  await staff.setTicketStatus(noodle, 'PREPARING');
  at(25);
  await staff.setTicketStatus(noodle, 'READY');
  at(27);
  await staff.serveTickets([noodle, bar]);
  await staff.recordPayment({ paymentId: 'p1', checkId, method: 'CASH', kind: 'BALANCE', expectedAmount: 110 });

  const report = kitchenReport(await staff.getDailyRecords('2026-11-06'));
  const [slowest, fastest] = report.stations;
  assert.equal(slowest.stationId, 'station-noodle');
  assert.deepEqual([slowest.waiting, slowest.cooking, slowest.passing, slowest.total, slowest.late], [10, 15, 2, 27, 1]);
  assert.equal(fastest.stationId, 'station-bar');
  assert.equal(fastest.passing, 24, 'the drink waited for the food');
  assert.equal(report.slowest[0].minutes, 25);
});

test('the daily report adds up discounts and the service charge', async () => {
  const restaurant = await demoRestaurant({ serviceChargeRate: 10 });
  const { staff } = restaurant;
  const checkId = await restaurant.open();
  await restaurant.send(checkId, [greens, tofu], 90);
  await staff.requestDiscount(checkId, { id: 'd1', kind: 'CHECK_AMOUNT', value: 30, reason: '店內活動' });
  const due = checkOf(await restaurant.state(), checkId).billTotal;
  await staff.recordPayment({ paymentId: 'p1', checkId, method: 'CARD', kind: 'BALANCE', expectedAmount: due });
  const report = dailyReport(await staff.getDailyRecords(businessDate(Date.now())));
  assert.equal(report.itemsTotal, 90);
  assert.equal(report.discountTotal, 30);
  assert.equal(report.serviceCharge, 6);
  assert.equal(report.billed, 66);
  assert.equal(report.received, 66);
  assert.deepEqual(
    report.discounts.map(({ target, description, amount }) => [target, description, amount]),
    [['整張帳單', '整單折 NT$30', 30]],
  );
});
