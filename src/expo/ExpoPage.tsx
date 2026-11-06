import { useApp } from '../appContext';
import {
  COURSE_LABEL,
  elapsedMinutes,
  isFullyVoided,
  openRounds,
  roundStatus,
  stationName,
  voidId,
  type Round,
} from '../domain';
import { urgencyOf } from '../kds/KdsPage';
import { ServeButton } from '../pos/FloorView';
import { ROUND_STATUS_LABEL } from '../pos/TableView';
import { useNow } from '../ui/useNow';

/**
 * The pass: every station's progress, by table and round. A round goes out only
 * when every station has finished it, so one table's food arrives together.
 */
export function ExpoPage() {
  const { live } = useApp();
  const now = useNow();
  const rounds = openRounds(live.state);
  const ready = rounds.filter((round) => roundStatus(live.state, round.tickets) === 'READY');
  const held = rounds.filter((round) => roundStatus(live.state, round.tickets) === 'HELD');
  const cooking = rounds.filter((round) => !ready.includes(round) && !held.includes(round));

  return (
    <div className="kds expo">
      <div className="kds-summary">
        <h1>出菜口</h1>
        <span>
          可上菜 {ready.length} ・ 製作中 {cooking.length} ・ 待叫菜 {held.length}
        </span>
      </div>
      {rounds.length === 0 && <p className="empty-note">目前沒有製作中的餐點</p>}
      {ready.length > 0 && (
        <section aria-label="可上菜">
          <h2 className="expo-heading">可上菜</h2>
          <div className="kds-grid">
            {ready.map((round) => (
              <RoundCard key={round.key} round={round} now={now} />
            ))}
          </div>
        </section>
      )}
      {cooking.length > 0 && (
        <section aria-label="製作中">
          <h2 className="expo-heading">製作中</h2>
          <div className="kds-grid">
            {cooking.map((round) => (
              <RoundCard key={round.key} round={round} now={now} />
            ))}
          </div>
        </section>
      )}
      {held.length > 0 && (
        <section aria-label="待叫菜">
          <h2 className="expo-heading">待叫菜（服務員叫菜後才開始製作）</h2>
          <div className="kds-grid">
            {held.map((round) => (
              <RoundCard key={round.key} round={round} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RoundCard({ round, now }: { round: Round; now: number }) {
  const { catalog, live, can } = useApp();
  const status = roundStatus(live.state, round.tickets);
  const minutes = elapsedMinutes(round.sentAt, now);
  const active = round.tickets.filter((ticket) => !isFullyVoided(live.state, ticket));
  return (
    <article className={`ticket ${status === 'READY' ? 'ticket-all-ready' : urgencyOf(minutes)}`}>
      <header className="ticket-header">
        <div>
          <span className="ticket-table">{round.tableName}</span>
          <span className="ticket-round">
            第 {round.round} 輪{round.course > 0 && `・${COURSE_LABEL[round.course]}`}
          </span>
        </div>
        <span className="ticket-time">{minutes} 分</span>
      </header>
      <ul className="ticket-lines">
        {active.map((ticket) => (
          <li key={ticket.id}>
            <div className="expo-station">
              <strong>{stationName(catalog, ticket.stationId)}</strong>
              <span className={`status-pill status-${ticket.status.toLowerCase()}`}>
                {ROUND_STATUS_LABEL[ticket.status]}
              </span>
            </div>
            <div className="line-options">
              {ticket.lines
                .filter((line) => live.state.voids[voidId(ticket.id, line.id)]?.status !== 'APPROVED')
                .map((line) => `${line.name}×${line.quantity}`)
                .join('、')}
            </div>
          </li>
        ))}
      </ul>
      {status === 'READY' && can('serve') && (
        <footer className="ticket-actions">
          <ServeButton round={round} wide />
        </footer>
      )}
    </article>
  );
}
