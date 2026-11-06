import {
  lineAmount,
  RejectedError,
  priceOrder,
  type MenuItem,
  type OrderItemInput,
  type TicketLine,
} from '../domain';

export interface CartLine extends OrderItemInput {
  id: string;
}

/**
 * The order id is kept so that a retried submit cannot duplicate, and changes
 * whenever the lines do, because a retry returns the order as first placed.
 */
export interface Cart {
  orderId: string;
  lines: CartLine[];
}

export const emptyCart = (): Cart => ({ orderId: crypto.randomUUID(), lines: [] });

export interface PricedCartLine {
  line: CartLine;
  /** Missing when the menu no longer offers this line, for example when sold out. */
  priced?: TicketLine;
}

/** An estimate from the menu this device has. The server sets the final amount. */
export function priceCart(menu: MenuItem[], cart: Cart) {
  const lines: PricedCartLine[] = cart.lines.map((line) => {
    try {
      return { line, priced: priceOrder(menu, [line], () => line.id).lines[0] };
    } catch (error) {
      if (!(error instanceof RejectedError)) throw error;
      return { line };
    }
  });
  return {
    lines,
    total: lines.reduce((sum, { priced }) => sum + (priced ? lineAmount(priced) : 0), 0),
    canOrder: lines.length > 0 && lines.every(({ priced }) => priced),
  };
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;
type StorageSource = () => KeyValueStore;

// Storage can be missing or refuse writes, for example in a private window. The
// cart then lasts until the page is reloaded, which still lets someone order.
function readJson<T>(storage: StorageSource, key: string): T | undefined {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeJson(storage: StorageSource, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // See above.
  }
}

const browserStorage: StorageSource = () => localStorage;
const cartKey = (tableToken: string) => `customer-cart-${tableToken}`;
const ordersKey = (tableToken: string) => `customer-orders-${tableToken}`;

// A device keeps showing its orders only for about one meal.
const RECENT_ORDER_MS = 6 * 60 * 60_000;

export const loadCart = (tableToken: string, storage = browserStorage) =>
  readJson<Cart>(storage, cartKey(tableToken)) ?? emptyCart();

export const saveCart = (tableToken: string, cart: Cart, storage = browserStorage) =>
  writeJson(storage, cartKey(tableToken), cart);

interface RecentOrder {
  id: string;
  placedAt: number;
}

export function loadRecentOrderIds(tableToken: string, now: number, storage = browserStorage) {
  return (readJson<RecentOrder[]>(storage, ordersKey(tableToken)) ?? [])
    .filter((order) => now - order.placedAt < RECENT_ORDER_MS)
    .map((order) => order.id);
}

export function rememberOrder(
  tableToken: string,
  id: string,
  now: number,
  storage = browserStorage,
) {
  const orders = (readJson<RecentOrder[]>(storage, ordersKey(tableToken)) ?? []).filter(
    (order) => order.id !== id && now - order.placedAt < RECENT_ORDER_MS,
  );
  writeJson(storage, ordersKey(tableToken), [...orders, { id, placedAt: now }]);
}
