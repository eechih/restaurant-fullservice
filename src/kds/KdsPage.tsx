import { useState } from 'react';
import { useAction, useApp } from '../appContext';
import {
  elapsedMinutes,
  isFullyVoided,
  stationName,
  ticketsAtStation,
  voidId,
  type KitchenTicket,
  type StationFilter,
  type TicketStatus,
} from '../domain';
import { LineDetails } from '../ui/LineDetails';
import { useNow } from '../ui/useNow';
import { loadStation, saveStation } from './station';

export const WARN_AFTER_MINUTES = 10;
export const LATE_AFTER_MINUTES = 20;

export const urgencyOf = (minutes: number) =>
  minutes >= LATE_AFTER_MINUTES ? 'is-late' : minutes >= WARN_AFTER_MINUTES ? 'is-warn' : '';

export function KdsPage() {
  const { catalog, live } = useApp();
  const now = useNow();
  const [station, setStation] = useState<StationFilter>(loadStation);
  const choose = (next: StationFilter) => {
    setStation(next);
    saveStation(next);
  };
  // A station deleted since this screen chose it shows everything instead.
  const showing =
    station === 'ALL' || station === 'NONE' || catalog.stations.some((candidate) => candidate.id === station)
      ? station
      : 'ALL';
  const queue = ticketsAtStation(live.state, showing, ['NEW', 'PREPARING']);
  const ready = ticketsAtStation(live.state, showing, ['READY']).filter((ticket) => !isFullyVoided(live.state, ticket));
  const hasUnassigned = Object.values(live.state.tickets).some(
    (ticket) => !ticket.stationId && ticket.status !== 'SERVED',
  );

  return (
    <div className="kds">
      <div className="kds-summary">
        <h1>{showing === 'ALL' ? '全部出餐站' : stationName(catalog, showing === 'NONE' ? null : showing)}</h1>
        <span>
          待製作 {queue.filter((ticket) => ticket.status === 'NEW').length} ・ 製作中{' '}
          {queue.filter((ticket) => ticket.status === 'PREPARING').length}
        </span>
      </div>
      {(catalog.stations.length > 0 || hasUnassigned) && (
        <div className="tabs" role="tablist" aria-label="出餐站">
          {[
            ['ALL', '全部'] as const,
            ...catalog.stations.map((candidate) => [candidate.id, candidate.name] as const),
            ...(hasUnassigned || showing === 'NONE' ? [['NONE', '未指定'] as const] : []),
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={showing === value}
              className={showing === value ? 'tab is-selected' : 'tab'}
              onClick={() => choose(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {queue.length === 0 ? (
        <p className="empty-note">目前沒有待製作的工作單</p>
      ) : (
        <div className="kds-grid">
          {queue.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} now={now} showStation={showing === 'ALL'} />
          ))}
        </div>
      )}
      {ready.length > 0 && (
        <section className="kds-ready" aria-label="已完成，等待出菜">
          <h2>已完成，等待出菜口</h2>
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

function TicketCard({ ticket, now, showStation }: { ticket: KitchenTicket; now: number; showStation: boolean }) {
  const { catalog, live, actions } = useApp();
  const { busy, run } = useAction();
  const minutes = elapsedMinutes(ticket.sentAt, now);
  const fullyVoided = isFullyVoided(live.state, ticket);
  const setStatus = (status: TicketStatus) => run(() => actions.setTicketStatus(ticket.id, status), '更新工作單失敗');

  return (
    <article className={`ticket ticket-${ticket.status.toLowerCase()} ${urgencyOf(minutes)}`}>
      <header className="ticket-header">
        <div>
          <span className="ticket-table">{ticket.tableName}</span>
          {ticket.round > 1 && <span className="ticket-round">加點 第 {ticket.round} 輪</span>}
          {showStation && <div className="ticket-station">{stationName(catalog, ticket.stationId)}</div>}
        </div>
        <span className="ticket-time">{minutes} 分</span>
      </header>
      <ul className="ticket-lines">
        {ticket.lines.map((line) => {
          const lineVoid = live.state.voids[voidId(ticket.id, line.id)];
          return (
            <li key={line.id} className={lineVoid?.status === 'APPROVED' ? 'is-voided' : ''}>
              <div className="ticket-line-main">
                <span className="ticket-qty">{line.quantity}×</span>
                <span className="ticket-name">{line.name}</span>
              </div>
              <LineDetails line={line} />
              {lineVoid?.status === 'APPROVED' && <div className="void-flag">已取消：{lineVoid.reason}</div>}
              {lineVoid?.status === 'REQUESTED' && (
                <div className="void-flag void-pending">申請取消中，先暫停製作</div>
              )}
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
              完成
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
        <strong>{ticket.tableName}</strong> 第 {ticket.round} 輪
      </span>
      <button
        className="button button-small"
        disabled={busy}
        onClick={() => run(() => actions.setTicketStatus(ticket.id, 'PREPARING'), '復原失敗')}
      >
        復原
      </button>
    </div>
  );
}
