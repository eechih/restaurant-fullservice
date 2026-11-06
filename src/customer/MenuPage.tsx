import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  formatMoney,
  lineAmount,
  orderCode,
  REJECTION_MESSAGE,
  RejectedError,
  type MenuItem,
  type OptionSelection,
} from '../domain';
import { ItemDialog, Stepper } from '../ui/ItemDialog';
import { LineDetails } from '../ui/LineDetails';
import { Modal } from '../ui/Modal';
import {
  emptyCart,
  loadCart,
  loadRecentOrderIds,
  priceCart,
  rememberOrder,
  saveCart,
  type Cart,
  type CartLine,
} from './cart';
import { menuQuery, tableQuery } from './queries';

const routeApi = getRouteApi('/order/$tableToken');

function useCart(tableToken: string) {
  const [cart, setCart] = useState(() => loadCart(tableToken));
  useEffect(() => saveCart(tableToken, cart), [tableToken, cart]);
  return {
    cart,
    setLines: (lines: CartLine[]) => setCart({ orderId: crypto.randomUUID(), lines }),
    clear: () => setCart(emptyCart()),
  };
}

export function MenuPage() {
  const { repository } = routeApi.useLoaderData();
  const { tableToken } = routeApi.useParams();
  const menu = useQuery(menuQuery(repository));
  const { cart, setLines, clear } = useCart(tableToken);
  const [categoryId, setCategoryId] = useState<string>();
  const [configuring, setConfiguring] = useState<MenuItem>();
  const [cartOpen, setCartOpen] = useState(false);

  if (!menu.data) {
    return (
      <main className="customer-main">
        <p className="empty-note" role={menu.isPending ? 'status' : 'alert'}>
          {menu.isPending ? '載入菜單中…' : '無法載入菜單，請重新整理頁面'}
        </p>
      </main>
    );
  }

  const { categories, items } = menu.data;
  const selectedCategory = categoryId ?? categories[0]?.id;
  const addLine = (item: MenuItem, selection: OptionSelection, quantity: number, note: string) =>
    setLines([
      ...cart.lines,
      {
        id: crypto.randomUUID(),
        menuItemId: item.id,
        quantity,
        choiceIds: Object.values(selection).flat(),
        note: note.trim() || null,
      },
    ]);
  const { total } = priceCart(items, cart);
  const count = cart.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <>
      <main className="customer-main">
        <RecentOrders />
        <div className="tabs" role="tablist">
          {categories.map((category) => (
            <button
              key={category.id}
              role="tab"
              aria-selected={category.id === selectedCategory}
              className={category.id === selectedCategory ? 'tab is-selected' : 'tab'}
              onClick={() => setCategoryId(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
        <div className="item-grid">
          {items
            .filter((item) => item.categoryId === selectedCategory)
            .map((item) => (
              <button
                key={item.id}
                className="item-card"
                disabled={item.available === false}
                onClick={() =>
                  item.optionGroups.length > 0 ? setConfiguring(item) : addLine(item, {}, 1, '')
                }
              >
                <span className="item-name">{item.name}</span>
                <span className="item-price">{formatMoney(item.price)}</span>
                {item.available === false ? (
                  <span className="item-hint">已售完</span>
                ) : (
                  item.optionGroups.length > 0 && <span className="item-hint">可選規格</span>
                )}
              </button>
            ))}
        </div>
      </main>

      {count > 0 && (
        <div className="cart-bar">
          <button className="button button-primary button-wide" onClick={() => setCartOpen(true)}>
            查看購物車（{count} 項）{formatMoney(total)}
          </button>
        </div>
      )}

      {configuring && (
        <ItemDialog
          item={configuring}
          onClose={() => setConfiguring(undefined)}
          onAdd={(selection, quantity, note) => {
            addLine(configuring, selection, quantity, note);
            setConfiguring(undefined);
          }}
        />
      )}
      {cartOpen && (
        <CartDialog
          cart={cart}
          menu={items}
          onChange={setLines}
          onPlaced={clear}
          onClose={() => setCartOpen(false)}
        />
      )}
    </>
  );
}

function RecentOrders() {
  const { tableToken } = routeApi.useParams();
  const [orderIds] = useState(() => loadRecentOrderIds(tableToken, Date.now()));
  if (orderIds.length === 0) return null;
  return (
    <nav className="customer-orders" aria-label="我的訂單">
      <span>我的訂單</span>
      {orderIds.map((orderId) => (
        <Link key={orderId} to="/order/$tableToken/$orderId" params={{ tableToken, orderId }}>
          #{orderCode(orderId)}
        </Link>
      ))}
    </nav>
  );
}

function rejectionMessage(error: unknown) {
  if (!(error instanceof RejectedError)) return '送出失敗，請再試一次';
  if (error.code === 'PRICE_CHANGED') return '菜單價格已更新，請確認金額後再送出';
  if (error.code === 'ITEM_UNAVAILABLE') return '有品項已售完，請移除後再送出';
  return REJECTION_MESSAGE[error.code];
}

function CartDialog({
  cart,
  menu,
  onChange,
  onPlaced,
  onClose,
}: {
  cart: Cart;
  menu: MenuItem[];
  onChange(lines: CartLine[]): void;
  onPlaced(): void;
  onClose(): void;
}) {
  const { repository } = routeApi.useLoaderData();
  const { tableToken } = routeApi.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { lines, total, canOrder } = priceCart(menu, cart);

  const place = useMutation({
    mutationFn: () =>
      repository.placeOrder({
        orderId: cart.orderId,
        tableToken,
        items: cart.lines.map(({ menuItemId, quantity, choiceIds, note }) => ({
          menuItemId,
          quantity,
          choiceIds,
          note,
        })),
        expectedTotal: total,
      }),
    onSuccess: (order) => {
      rememberOrder(tableToken, order.id, Date.now());
      onPlaced();
      void navigate({
        to: '/order/$tableToken/$orderId',
        params: { tableToken, orderId: order.id },
      });
    },
    onError: (error) => {
      if (!(error instanceof RejectedError)) return;
      // This device's copy is out of date. Refreshing shows the customer the new
      // amounts or the sold out lines before they try again.
      void queryClient.invalidateQueries({ queryKey: menuQuery(repository).queryKey });
      if (error.code === 'TABLE_NOT_FOUND') {
        void queryClient.invalidateQueries({
          queryKey: tableQuery(repository, tableToken).queryKey,
        });
      }
    },
  });

  const setQuantity = (lineId: string, quantity: number) => {
    place.reset();
    const next =
      quantity === 0
        ? cart.lines.filter((line) => line.id !== lineId)
        : cart.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line));
    onChange(next);
    if (next.length === 0) onClose();
  };

  return (
    <Modal
      title="購物車"
      onClose={onClose}
      footer={
        <>
          <div className="cart-total">
            <span>預估合計</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          {place.isError && (
            <p className="warning-note" role="alert">
              {rejectionMessage(place.error)}
            </p>
          )}
          <p className="field-hint">送出後由服務員確認，確認後才會開始製作。用餐完畢再一起結帳。</p>
          <button
            className="button button-primary button-wide order-submit"
            disabled={!canOrder || place.isPending}
            onClick={() => place.mutate()}
          >
            {place.isPending ? '送出中…' : '送出訂單'}
          </button>
        </>
      }
    >
      <ul className="cart-lines">
        {lines.map(({ line, priced }) => {
          const name = menu.find((item) => item.id === line.menuItemId)?.name ?? '已下架品項';
          return (
            <li key={line.id}>
              <div className="cart-line-main">
                <span>{name}</span>
                {priced && <span>{formatMoney(lineAmount(priced))}</span>}
              </div>
              {priced ? (
                <LineDetails line={priced} />
              ) : (
                <div className="cart-unavailable">已售完或已變更，請移除</div>
              )}
              <div className="cart-line-tools">
                <Stepper
                  value={line.quantity}
                  min={0}
                  label={name}
                  onChange={(quantity) => setQuantity(line.id, quantity)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
