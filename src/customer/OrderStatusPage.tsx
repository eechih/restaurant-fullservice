import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { clockTime, formatMoney, lineAmount, orderCode, type TicketStatus } from '../domain';
import { LineDetails } from '../ui/LineDetails';
import { orderQuery } from './queries';

const layoutApi = getRouteApi('/order/$tableToken');
const routeApi = getRouteApi('/order/$tableToken/$orderId');

const KITCHEN_STATUS: Record<TicketStatus, { title: string; detail: string }> = {
  NEW: { title: '已送廚，等待製作', detail: '廚房很快就會開始製作。' },
  PREPARING: { title: '製作中', detail: '請稍候，完成後會為您送上。' },
  READY: { title: '已完成', detail: '餐點即將送上。' },
  SERVED: { title: '已上菜', detail: '請慢用。用餐完畢請告訴服務員結帳。' },
};

export function OrderStatusPage() {
  const { repository } = layoutApi.useLoaderData();
  const { tableToken } = layoutApi.useParams();
  const { orderId } = routeApi.useParams();
  const { data: order, isPending, isError } = useQuery(orderQuery(repository, orderId));

  const backToMenu = (label: string, primary = false) => (
    <Link to="/order/$tableToken" params={{ tableToken }} className={primary ? 'button button-primary' : 'button'}>
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

  const isVoided = (lineId: string) => order.voidedLineIds.includes(lineId);
  const allVoided = order.lines.length > 0 && order.lines.every((line) => isVoided(line.id));
  const kitchen = order.kitchenStatus ? KITCHEN_STATUS[order.kitchenStatus] : undefined;
  const billed = order.lines.filter((line) => !isVoided(line.id)).reduce((sum, line) => sum + lineAmount(line), 0);
  return (
    <main className="customer-main">
      {/* Announces each change, because people look away while they wait. */}
      <section className="order-summary" aria-live="polite">
        {order.status === 'PENDING' && (
          <>
            <h2>等待服務員確認</h2>
            <p>服務員確認後就會送廚。如果等了很久，可以告訴服務員訂單編號。</p>
            <div className="order-code">#{orderCode(order.id)}</div>
            <p>
              合計 {formatMoney(order.total)}，請於 {clockTime(order.expiresAt)} 前由服務員確認
            </p>
          </>
        )}
        {order.status === 'SENT' && (
          <>
            <h2>{allVoided ? '訂單已取消' : (kitchen?.title ?? '已送廚')}</h2>
            {!allVoided && <p>{kitchen?.detail}</p>}
            <div className="order-code">#{orderCode(order.id)}</div>
            <p>這筆合計 {formatMoney(billed)}，會加到這桌的帳單，用餐完畢再一起結帳。</p>
          </>
        )}
        {order.status === 'REJECTED' && (
          <>
            <h2>服務員沒有接受這筆訂單</h2>
            <p>廚房不會製作。有疑問請洽服務員，或重新點餐。</p>
          </>
        )}
        {order.status === 'EXPIRED' && (
          <>
            <h2>訂單已逾時</h2>
            <p>這筆訂單沒有在時間內確認，廚房不會製作。如需加點請重新點餐，或洽服務員。</p>
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
            {isVoided(line.id) && <div className="cart-unavailable">已取消，不會算在帳單上</div>}
          </li>
        ))}
      </ul>
      <div className="order-actions">
        {backToMenu(order.status === 'SENT' || order.status === 'PENDING' ? '繼續加點' : '重新點餐', order.status !== 'PENDING' && order.status !== 'SENT')}
      </div>
    </main>
  );
}
