import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleCatalog } from '../data/sampleCatalog';
import { loadCart, loadRecentOrderIds, priceCart, rememberOrder, saveCart } from './cart';

const menu = sampleCatalog.items;
const greens = { id: 'l1', menuItemId: 'item-greens', quantity: 2, choiceIds: [] };

const memoryStorage = () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  return () => storage;
};

test('a cart is priced from the current menu', () => {
  const { total, canOrder } = priceCart(menu, { orderId: 'o', lines: [greens] });
  assert.equal(total, 80);
  assert.equal(canOrder, true);

  const repriced = menu.map((item) => (item.id === 'item-greens' ? { ...item, price: 50 } : item));
  assert.equal(priceCart(repriced, { orderId: 'o', lines: [greens] }).total, 100);
});

test('a sold out line stays in the cart but blocks ordering', () => {
  const soldOut = menu.map((item) =>
    item.id === 'item-greens' ? { ...item, available: false } : item,
  );
  const tofu = { id: 'l2', menuItemId: 'item-tofu', quantity: 1, choiceIds: [] };
  const { lines, total, canOrder } = priceCart(soldOut, { orderId: 'o', lines: [greens, tofu] });
  assert.equal(lines[0].priced, undefined);
  assert.equal(total, 50);
  assert.equal(canOrder, false);
});

test('an empty cart cannot be ordered', () => {
  assert.equal(priceCart(menu, { orderId: 'o', lines: [] }).canOrder, false);
});

test('a cart survives a reload, separately for each table', () => {
  const storage = memoryStorage();
  const cart = { orderId: 'o1', lines: [greens] };
  saveCart('table-1', cart, storage);
  assert.deepEqual(loadCart('table-1', storage), cart);
  assert.deepEqual(loadCart('table-2', storage).lines, []);
});

test('unusable storage does not stop someone ordering', () => {
  const broken = () => {
    throw new Error('blocked');
  };
  assert.deepEqual(loadCart('table-1', broken).lines, []);
  assert.doesNotThrow(() => saveCart('table-1', { orderId: 'o', lines: [] }, broken));
  assert.doesNotThrow(() => rememberOrder('table-1', 'o', 0, broken));
  assert.deepEqual(loadRecentOrderIds('table-1', 0, broken), []);
});

test('a device forgets its orders after the meal', () => {
  const storage = memoryStorage();
  const hour = 60 * 60_000;
  rememberOrder('table-1', 'old', 0, storage);
  rememberOrder('table-1', 'new', 5 * hour, storage);
  assert.deepEqual(loadRecentOrderIds('table-1', 5 * hour, storage), ['old', 'new']);
  assert.deepEqual(loadRecentOrderIds('table-1', 7 * hour, storage), ['new']);
});
