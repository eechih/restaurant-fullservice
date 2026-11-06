import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { formatMoney, isTakeout, lineAmount, orderCode, type TicketStatus } from '../domain';
import { LineDetails } from '../ui/LineDetails';
import { orderQuery } from './queries';

const layoutApi = getRouteApi('/order/$tableToken');
const routeApi = getRouteApi('/order/$tableToken/$orderId');

const KITCHEN_STATUS: Record<TicketStatus, { title: string; detail: string }> = {
  NEW: { title: '已付款，等待製作', detail: '廚房很快就會開始製作。' },
  PREPARING: { title: '製作中', detail: '請稍候，完成後會為您送上。' },
  READY: { title: '已完成', detail: '餐點即將送上。' },
  SERVED: { title: '已上菜', detail: '請慢用。' },
};
const TAKEOUT_STATUS: Record<TicketStatus, { title: string; detail: string }> = {
  NEW: { title: '已付款，等待製作', detail: '完成後會在叫號螢幕顯示您的號碼。' },
  PREPARING: { title: '製作中', detail: '完成後會在叫號螢幕顯示您的號碼。' },
  READY: { title: '請到櫃台取餐', detail: '您的餐點已完成。' },
  SERVED: { title: '已取餐', detail: '謝謝光臨。' },
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

export function OrderStatusPage() {
  const { repository } = layoutApi.useLoaderData();
  const { tableToken } = layoutApi.useParams();
  const { orderId } = routeApi.useParams();
  const { data: order, isPending, isError } = useQuery(orderQuery(repository, orderId));

  const backToMenu = (label: string, primary = false) => (
    <Link
      to="/order/$tableToken"
      params={{ tableToken }}
      className={primary ? 'button button-primary' : 'button'}
    >
      {label}
    </Link>
  );

  if (!order) {
    return (
      <main className="customer-main">
        <p className="empty-note" role={isPending ? 'status' : 'alert'}>
          {isPending ? '載入訂單中…' : isError ? '無法載入訂單，請重新整理頁面' : '找不到這筆訂單'}
        </p>
        {!isPending && <div className="order-actions">{backToMenu('回到菜單')}</div>}
      </main>
    );
  }

  const takeout = isTakeout(order);
  const kitchen = order.ticketStatus
    ? (takeout ? TAKEOUT_STATUS : KITCHEN_STATUS)[order.ticketStatus]
    : undefined;
  const isVoided = (lineId: string) => order.voidedLineIds.includes(lineId);
  const refund = order.lines
    .filter((line) => isVoided(line.id))
    .reduce((sum, line) => sum + lineAmount(line), 0);
  const allVoided = order.lines.every((line) => isVoided(line.id));
  return (
    <main className="customer-main">
      {/* Announces each change, because people look away while they wait. */}
      <section className="order-summary" aria-live="polite">
        {order.status === 'PENDING' && (
          <>
            <h2>請到櫃台付款</h2>
            <p>
              告知訂單編號，付款後才會開始製作
              {takeout ? '，並給您取餐號。' : '。'}
            </p>
            <div className="order-code">#{orderCode(order.id)}</div>
            <p>應付 {formatMoney(order.total)}，請於 {formatTime(order.expiresAt)} 前完成</p>
          </>
        )}
        {order.status === 'PAID' && (
          <>
            <h2 className={takeout && order.ticketStatus === 'READY' ? 'pickup-call' : undefined}>
              {allVoided ? '訂單已取消' : (kitchen?.title ?? '已付款')}
            </h2>
            {!allVoided && <p>{kitchen?.detail}</p>}
            {takeout && order.pickupNumber != null ? (
              <>
                <p className="pickup-number-label">取餐號</p>
                <div className="order-code pickup-number">{order.pickupNumber}</div>
              </>
            ) : (
              <div className="order-code">#{orderCode(order.id)}</div>
            )}
            <p>已付款 {formatMoney(order.total)}</p>
            {refund > 0 && (
              <p className="warning-note">有品項已取消，請到櫃台退款 {formatMoney(refund)}。</p>
            )}
          </>
        )}
        {order.status === 'EXPIRED' && (
          <>
            <h2>訂單已逾時</h2>
            <p>這筆訂單沒有付款，廚房不會製作。如需用餐請重新點餐。</p>
          </>
        )}
      </section>
      {isError && (
        <p className="warning-note" role="alert">
          暫時無法更新狀態，正在重試。
        </p>
      )}
      <ul className="order-lines cart-lines" aria-label="訂單內容">
        {order.lines.map((line) => (
          <li key={line.id} className={isVoided(line.id) ? 'is-cancelled' : undefined}>
            <div className="cart-line-main">
              <span>
                {line.name} × {line.quantity}
              </span>
              <span>{formatMoney(lineAmount(line))}</span>
            </div>
            <LineDetails line={line} />
            {isVoided(line.id) && <div className="cart-unavailable">已取消</div>}
          </li>
        ))}
      </ul>
      <div className="order-actions">
        {backToMenu(order.status === 'EXPIRED' ? '重新點餐' : '繼續點餐', order.status === 'EXPIRED')}
      </div>
    </main>
  );
}
