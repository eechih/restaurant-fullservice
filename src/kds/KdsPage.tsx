import { useAction, useApp } from '../appContext';
import { useNow } from '../ui/useNow';
import {
  elapsedMinutes,
  isFullyVoided,
  isLineVoided,
  ticketsWithStatus,
  voidId,
  type KitchenTicket,
  type TicketStatus,
} from '../domain';
import { LineDetails } from '../ui/LineDetails';

const WARN_AFTER_MINUTES = 10;
const LATE_AFTER_MINUTES = 20;

export function KdsPage() {
  const { live } = useApp();
  const now = useNow();
  const queue = ticketsWithStatus(live.state, ['NEW', 'PREPARING']);
  const ready = ticketsWithStatus(live.state, ['READY']).filter(
    (ticket) => !isFullyVoided(live.state, ticket),
  );

  return (
    <div className="kds">
      <div className="kds-summary">
        <h1>廚房工作單</h1>
        <span>
          待製作 {queue.filter((ticket) => ticket.status === 'NEW').length} ・ 製作中{' '}
          {queue.filter((ticket) => ticket.status === 'PREPARING').length}
        </span>
      </div>
      {queue.length === 0 ? (
        <p className="empty-note">目前沒有待製作的工作單</p>
      ) : (
        <div className="kds-grid">
          {queue.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} now={now} />
          ))}
        </div>
      )}
      {ready.length > 0 && (
        <section className="kds-ready" aria-label="已完成，等待上菜">
          <h2>已完成，等待上菜</h2>
          <div className="kds-ready-list">
            {ready.map((ticket) => (
              <ReadyChip key={ticket.id} ticket={ticket} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TicketCard({ ticket, now }: { ticket: KitchenTicket; now: number }) {
  const { live, actions } = useApp();
  const { busy, run } = useAction();
  const minutes = elapsedMinutes(ticket.sentAt, now);
  const fullyVoided = isFullyVoided(live.state, ticket);
  const urgency =
    minutes >= LATE_AFTER_MINUTES ? 'is-late' : minutes >= WARN_AFTER_MINUTES ? 'is-warn' : '';
  const setStatus = (status: TicketStatus) =>
    run(() => actions.setTicketStatus(ticket, status), '更新工作單失敗');

  return (
    <article className={`ticket ticket-${ticket.status.toLowerCase()} ${urgency}`}>
      <header className="ticket-header">
        <div>
          <span className="ticket-table">{ticket.tableName}</span>
          {ticket.round > 1 && <span className="ticket-round">加點 第 {ticket.round} 輪</span>}
        </div>
        <span className="ticket-time">{minutes} 分</span>
      </header>
      <ul className="ticket-lines">
        {ticket.lines.map((line) => {
          const lineVoid = live.state.voids[voidId(ticket.id, line.id)];
          return (
            <li key={line.id} className={isLineVoided(live.state, ticket.id, line.id) ? 'is-voided' : ''}>
              <div className="ticket-line-main">
                <span className="ticket-qty">{line.quantity}×</span>
                <span className="ticket-name">{line.name}</span>
              </div>
              <LineDetails line={line} />
              {lineVoid && <div className="void-flag">已取消：{lineVoid.reason}</div>}
            </li>
          );
        })}
      </ul>
      <footer className="ticket-actions">
        {fullyVoided ? (
          <button className="button button-danger" disabled={busy} onClick={() => setStatus('SERVED')}>
            整單已取消，移除
          </button>
        ) : ticket.status === 'NEW' ? (
          <button className="button button-primary" disabled={busy} onClick={() => setStatus('PREPARING')}>
            開始製作
          </button>
        ) : (
          <>
            <button className="button" disabled={busy} onClick={() => setStatus('NEW')}>退回</button>
            <button className="button button-primary" disabled={busy} onClick={() => setStatus('READY')}>
              完成出餐
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function ReadyChip({ ticket }: { ticket: KitchenTicket }) {
  const { actions } = useApp();
  const { busy, run } = useAction();
  return (
    <div className="ready-chip">
      <span>
        <strong>{ticket.tableName}</strong>
        {ticket.pickupNumber == null && ` 第 ${ticket.round} 輪`}
      </span>
      <button
        className="button button-small"
        disabled={busy}
        onClick={() => run(() => actions.setTicketStatus(ticket, 'PREPARING'), '復原失敗')}
      >
        復原
      </button>
    </div>
  );
}
