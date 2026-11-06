import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useAction, useApp } from '../appContext';
import {
  balanceOf,
  billFor,
  billRequests,
  clockTime,
  COURSE_LABEL,
  describeDiscount,
  discountRequests,
  elapsedMinutes,
  formatMoney,
  isFullyVoided,
  lineAmount,
  openCheckFor,
  orderCode,
  pendingOrders,
  readyRounds,
  RejectedError,
  roundsForCheck,
  roundStatus,
  suggestTables,
  tableState,
  upcomingReservations,
  voidRequests,
  waitingParties,
  zonesOf,
  type DiningTable,
  type Discount,
  type GuestCheck,
  type LineVoid,
  type Order,
  type Round,
  type WaitlistEntry,
} from '../domain';
import { Stepper } from '../ui/ItemDialog';
import { Modal } from '../ui/Modal';
import { useNow } from '../ui/useNow';

function useGoToTable() {
  const navigate = useNavigate();
  return (tableId: string) => void navigate({ to: '/pos/table/$tableId', params: { tableId } });
}

const ALL_ZONES = '';

export function FloorView() {
  const { catalog, live, actions, can } = useApp();
  const { busy, run } = useAction();
  const [zone, setZone] = useState(ALL_ZONES);
  const [opening, setOpening] = useState<DiningTable>();
  const [cleaning, setCleaning] = useState<DiningTable>();

  if (catalog.tables.length === 0) {
    return can('settings') ? (
      <div className="seed-prompt">
        <h1>還沒有桌位和菜單</h1>
        <p>到店務設定建立自己的桌位、出餐站和菜單，或先匯入 11 張桌位、4 個出餐站和 12 道範例菜色試用。</p>
        <Link to="/pos/settings/tables" className="button button-primary">前往店務設定</Link>
        <button className="button" disabled={busy} onClick={() => run(actions.seedCatalog, '匯入範例資料失敗')}>
          {busy ? '匯入中…' : '匯入範例資料'}
        </button>
      </div>
    ) : (
      <div className="seed-prompt">
        <h1>還沒有桌位和菜單</h1>
        <p>請店長登入，在店務設定建立桌位和菜單。</p>
      </div>
    );
  }

  const zones = zonesOf(catalog.tables);
  const tables = zone === ALL_ZONES ? catalog.tables : catalog.tables.filter((table) => table.zone === zone);
  const count = (state: ReturnType<typeof tableState>) =>
    catalog.tables.filter((table) => tableState(live.state, table.id) === state).length;

  return (
    <div className="floor">
      <section aria-label="桌位">
        <div className="floor-header">
          <h1 className="section-title">桌位</h1>
          <span className="field-hint">
            空桌 {count('EMPTY')}・用餐中 {count('DINING')}・待清理 {count('CLEANING')}
          </span>
        </div>
        {zones.length > 1 && (
          <div className="tabs" role="tablist" aria-label="分區">
            {[ALL_ZONES, ...zones].map((candidate) => (
              <button
                key={candidate}
                role="tab"
                aria-selected={zone === candidate}
                className={zone === candidate ? 'tab is-selected' : 'tab'}
                onClick={() => setZone(candidate)}
              >
                {candidate || '全部'}
              </button>
            ))}
          </div>
        )}
        <div className="table-grid">
          {tables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              onOpen={() => setOpening(table)}
              onClean={() => setCleaning(table)}
            />
          ))}
        </div>
      </section>
      <div className="floor-side">
        {can('waitlist') && <WaitlistPanel />}
        {can('approve') && <ApprovalsPanel />}
        {can('order') && <PendingOrdersPanel />}
        {can('serve') && <ReadyPanel />}
        {can('checkout') && <BillRequestsPanel />}
      </div>
      {opening && <OpenTableDialog table={opening} onClose={() => setOpening(undefined)} />}
      {cleaning && <CleanTableDialog table={cleaning} onClose={() => setCleaning(undefined)} />}
    </div>
  );
}

function TableCard({ table, onOpen, onClean }: { table: DiningTable; onOpen(): void; onClean(): void }) {
  const { live, can } = useApp();
  const goToTable = useGoToTable();
  const now = useNow();
  const status = tableState(live.state, table.id);
  const check = live.state.checks[live.state.seatings[table.id]?.checkId];

  if (status === 'EMPTY') {
    return (
      <button className="table-card table-empty" disabled={!can('openTable')} onClick={onOpen}>
        <span className="table-name">{table.name}</span>
        <span className="table-meta">空桌・{table.seats} 人座</span>
      </button>
    );
  }
  if (status === 'CLEANING' && check) {
    return (
      <button
        className="table-card table-cleaning"
        onClick={can('clearTable') ? onClean : () => goToTable(table.id)}
      >
        <span className="table-name">{table.name}</span>
        <span className="table-meta">已結帳 {formatMoney(check.paidTotal)}</span>
        <span className="table-flag">待清理</span>
      </button>
    );
  }
  if (!check) {
    return (
      <button className="table-card" onClick={() => goToTable(table.id)}>
        <span className="table-name">{table.name}</span>
        <span className="table-meta">載入中…</span>
      </button>
    );
  }

  const rounds = roundsForCheck(live.state, check.id);
  const ready = rounds.filter((round) => roundStatus(live.state, round.tickets) === 'READY').length;
  const waiting = pendingOrders(live.state, now).filter((order) => order.tableId === table.id).length;
  const approvals =
    voidRequests(live.state).filter((lineVoid) => lineVoid.checkId === check.id).length +
    check.discounts.filter((discount) => discount.status === 'REQUESTED').length;

  return (
    <button className="table-card table-dining" onClick={() => goToTable(table.id)}>
      <span className="table-name">{table.name}</span>
      {check.tableName !== table.name && <span className="table-flag flag-info">併桌 {check.tableName}</span>}
      <span className="table-meta">
        {check.partyName && `${check.partyName}・`}
        {check.guestCount ? `${check.guestCount} 人・` : ''}
        {elapsedMinutes(check.openedAt, now)} 分鐘
      </span>
      <span className="table-amount">{formatMoney(check.billTotal)}</span>
      <span className="table-flags">
        {waiting > 0 && <span className="table-flag flag-info">{waiting} 筆待確認</span>}
        {ready > 0 && <span className="table-flag flag-ok">{ready} 輪可上菜</span>}
        {approvals > 0 && <span className="table-flag flag-danger">待主管核准</span>}
        {check.billRequestedAt && <span className="table-flag flag-warn">請結帳</span>}
      </span>
    </button>
  );
}

function OpenTableDialog({
  table,
  entry,
  onClose,
}: {
  table: DiningTable;
  entry?: WaitlistEntry;
  onClose(): void;
}) {
  const { actions, notify } = useApp();
  const goToTable = useGoToTable();
  const { busy, run } = useAction();
  const [guestCount, setGuestCount] = useState(entry?.partySize ?? Math.min(table.seats, 4));
  // Kept for the dialog's life, so that retrying after a timeout cannot open the table twice.
  const [checkId] = useState(() => crypto.randomUUID());

  const open = () =>
    run(async () => {
      try {
        await actions.openTable({ checkId, tableId: table.id, guestCount, waitlistEntryId: entry?.id });
      } catch (error) {
        if (!(error instanceof RejectedError) || error.code !== 'TABLE_OCCUPIED') throw error;
        notify(`${table.name} 剛被其他人開桌`, true);
        onClose();
        return;
      }
      onClose();
      if (entry) notify(`${entry.name} 已帶位到 ${table.name}`);
      else goToTable(table.id);
    }, '開桌失敗');

  return (
    <Modal
      title={entry ? `${entry.name} 帶位到 ${table.name}` : `${table.name} 開桌`}
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy} onClick={open}>
          {entry ? '帶位並開桌' : '開桌'}（{guestCount} 人）
        </button>
      }
    >
      <p className="field-label">用餐人數</p>
      <Stepper value={guestCount} min={1} label="用餐人數" onChange={setGuestCount} />
      {guestCount > table.seats && (
        <p className="warning-note">{table.name} 只有 {table.seats} 個座位，請確認是否要併桌或加椅。</p>
      )}
    </Modal>
  );
}

function CleanTableDialog({ table, onClose }: { table: DiningTable; onClose(): void }) {
  const { actions, notify } = useApp();
  const goToTable = useGoToTable();
  const { busy, run } = useAction();
  const clean = () =>
    run(async () => {
      await actions.markTableCleaned(table.id);
      notify(`${table.name} 已清理，可以帶位`);
      onClose();
    }, '更新桌況失敗');
  return (
    <Modal
      title={`${table.name} 已結帳`}
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy} onClick={clean}>
          已清理，可以帶位
        </button>
      }
    >
      <p>桌面清理好之後按下方按鈕，這桌就會變回空桌。</p>
      <button className="link-button" onClick={() => goToTable(table.id)}>查看帳單</button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

function Panel({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <aside className="ready-panel" aria-label={title}>
      <h2 className="section-title">
        {title} {count > 0 && <span className="count">{count}</span>}
      </h2>
      {children}
    </aside>
  );
}

function WaitlistPanel() {
  const { live } = useApp();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [seating, setSeating] = useState<WaitlistEntry>();
  const parties = waitingParties(live.state, now);
  return (
    <Panel title="候位與今日訂位" count={parties.length}>
      <button className="button button-small button-wide" onClick={() => setAdding(true)}>
        新增候位
      </button>
      {parties.length === 0 && <p className="empty-note">目前沒有人候位，今天也沒有待到的訂位</p>}
      {parties.map((entry) => (
        <WaitlistRow key={entry.id} entry={entry} now={now} onSeat={() => setSeating(entry)} />
      ))}
      {adding && <AddWaitlistDialog onClose={() => setAdding(false)} />}
      {seating && <SeatDialog entry={seating} onClose={() => setSeating(undefined)} />}
    </Panel>
  );
}

/** How a booking or a walk-in is doing: when it is due, or how long they have waited. */
function waitText(entry: WaitlistEntry, now: number) {
  if (!entry.reservedFor) return `等了 ${elapsedMinutes(entry.createdAt, now)} 分鐘`;
  const late = elapsedMinutes(entry.reservedFor, now);
  return Date.parse(entry.reservedFor) > now ? `訂位 ${clockTime(entry.reservedFor)}` : `訂位 ${clockTime(entry.reservedFor)}，晚到 ${late} 分鐘`;
}

export function WaitlistRow({
  entry,
  now,
  onSeat,
}: {
  entry: WaitlistEntry;
  now: number;
  onSeat?: () => void;
}) {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const due = entry.reservedFor ? Date.parse(entry.reservedFor) : undefined;
  const cancel = (noShow: boolean) =>
    run(async () => {
      await actions.cancelWaitlistEntry(entry.id, noShow);
      notify(noShow ? `已記錄 ${entry.name} 未到` : `已取消 ${entry.name} 的${entry.reservedFor ? '訂位' : '候位'}`);
    }, '更新失敗');
  return (
    <div className="ready-row ready-row-stack">
      <div>
        {entry.reservedFor && <span className="badge badge-ok">訂位</span>} <strong>{entry.name}</strong> {entry.partySize} 位
        <div className={due !== undefined && due < now - 15 * 60_000 ? 'line-note' : 'line-options'}>
          {waitText(entry, now)}
          {entry.phone && `・${entry.phone}`}
        </div>
        {entry.note && <div className="line-options">備註：{entry.note}</div>}
      </div>
      <div className="chip-row">
        {onSeat && (
          <button className="button button-primary button-small" onClick={onSeat}>
            帶位
          </button>
        )}
        {due !== undefined && due < now && (
          <button className="button button-small" disabled={busy} onClick={() => cancel(true)}>
            未到
          </button>
        )}
        <button className="button button-small" disabled={busy} onClick={() => cancel(false)}>
          取消
        </button>
      </div>
    </div>
  );
}

/** Adds a walk-in to the waitlist, or a booking when a date is given. */
export function AddWaitlistDialog({ date, onClose }: { date?: string; onClose(): void }) {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const booking = date !== undefined;
  const [name, setName] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [phone, setPhone] = useState('');
  const [day, setDay] = useState(date ?? '');
  const [time, setTime] = useState('18:00');
  const [note, setNote] = useState('');
  const [id] = useState(() => crypto.randomUUID());
  // The restaurant's clock is UTC+8.
  const reservedFor = booking && day && time ? new Date(`${day}T${time}:00+08:00`).toISOString() : null;
  const add = () =>
    run(async () => {
      await actions.addToWaitlist({ id, name, partySize, phone, reservedFor, note });
      notify(
        booking && reservedFor
          ? `已訂位：${name.trim()} ${partySize} 位，${day} ${time}`
          : `${name.trim()} ${partySize} 位已加入候位`,
      );
      onClose();
    }, booking ? '訂位失敗' : '新增候位失敗');
  return (
    <Modal
      title={booking ? '新增訂位' : '新增候位'}
      onClose={onClose}
      footer={
        <button
          className="button button-primary button-wide"
          disabled={busy || !name.trim() || (booking && !reservedFor)}
          onClick={add}
        >
          {booking ? '訂位' : '加入候位'}
        </button>
      }
    >
      <label className="field-label" htmlFor="waitlist-name">稱呼</label>
      <input
        id="waitlist-name"
        className="text-input"
        value={name}
        maxLength={40}
        placeholder="例如：王先生"
        onChange={(event) => setName(event.target.value)}
      />
      <p className="field-label">人數</p>
      <Stepper value={partySize} min={1} label="人數" onChange={setPartySize} />
      {booking && (
        <div className="booking-when">
          <label>
            <span className="field-label">日期</span>
            <input className="text-input" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          </label>
          <label>
            <span className="field-label">時間</span>
            <input
              className="text-input"
              type="time"
              step={900}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>
      )}
      <label className="field-label" htmlFor="waitlist-phone">
        電話<span className="field-hint">{booking ? '建議填寫，方便聯絡' : '選填，用來通知入座'}</span>
      </label>
      <input
        id="waitlist-phone"
        className="text-input"
        type="tel"
        inputMode="tel"
        maxLength={20}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      {booking && (
        <>
          <label className="field-label" htmlFor="waitlist-note">
            備註<span className="field-hint">例如兒童椅、靠窗、慶生</span>
          </label>
          <input
            id="waitlist-note"
            className="text-input"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
          />
        </>
      )}
    </Modal>
  );
}

export function SeatDialog({ entry, onClose }: { entry: WaitlistEntry; onClose(): void }) {
  const { catalog, live } = useApp();
  const now = useNow();
  const [table, setTable] = useState<DiningTable>();
  const fits = suggestTables(catalog, live.state, entry.partySize);
  const others = catalog.tables.filter(
    (candidate) => tableState(live.state, candidate.id) === 'EMPTY' && !fits.includes(candidate),
  );
  // Other parties booked soon, who will need tables too.
  const booked = upcomingReservations(live.state, now).filter((other) => other.id !== entry.id);
  if (table) return <OpenTableDialog table={table} entry={entry} onClose={onClose} />;
  const choice = (candidate: DiningTable) => (
    <button key={candidate.id} className="chip" onClick={() => setTable(candidate)}>
      {candidate.name}
      <span className="field-hint">{candidate.zone ? `${candidate.zone}・` : ''}{candidate.seats} 人座</span>
    </button>
  );
  return (
    <Modal
      title={`${entry.name} ${entry.partySize} 位，帶到哪一桌？`}
      onClose={onClose}
      footer={<button className="button button-wide" onClick={onClose}>稍後再帶位</button>}
    >
      {booked.length > 0 && (
        <p className="warning-note">
          接下來 2 小時還有 {booked.length} 組訂位（
          {booked.map((other) => `${clockTime(other.reservedFor ?? '')} ${other.partySize} 位`).join('、')}），請留桌給他們。
        </p>
      )}
      <p className="field-label">建議的空桌</p>
      {fits.length > 0 ? (
        <div className="chip-row">{fits.map(choice)}</div>
      ) : (
        <p className="empty-note">目前沒有坐得下 {entry.partySize} 位的空桌</p>
      )}
      {others.length > 0 && (
        <>
          <p className="field-label">其他空桌<span className="field-hint">座位不夠，要併桌或加椅</span></p>
          <div className="chip-row">{others.map(choice)}</div>
        </>
      )}
    </Modal>
  );
}

function PendingOrdersPanel() {
  const { live } = useApp();
  const now = useNow();
  const orders = pendingOrders(live.state, now);
  return (
    <Panel title="掃碼點餐待確認" count={orders.length}>
      {orders.length === 0 ? (
        <p className="empty-note">顧客掃碼點的單會先出現在這裡，確認後才送廚</p>
      ) : (
        orders.map((order) => <PendingOrder key={order.id} order={order} />)
      )}
    </Panel>
  );
}

function PendingOrder({ order }: { order: Order }) {
  const { live, actions, notify } = useApp();
  const { busy, run } = useAction();
  const goToTable = useGoToTable();
  const open = Boolean(openCheckFor(live.state, order.tableId));
  return (
    <div className="ready-row ready-row-stack">
      <div>
        <strong>{order.tableName}</strong> #{orderCode(order.id)} {formatMoney(order.total)}
        <div className="line-options">{order.lines.map((line) => `${line.name}×${line.quantity}`).join('、')}</div>
        {!open && <div className="line-note">這桌還沒開桌。請先確認客人已入座並開桌</div>}
      </div>
      <div className="chip-row">
        {open ? (
          <button
            className="button button-primary button-small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await actions.confirmCustomerOrder(order.id);
                notify(`${order.tableName} 的掃碼點餐已送廚`);
              }, '確認失敗')
            }
          >
            確認送廚
          </button>
        ) : (
          <button className="button button-small" onClick={() => goToTable(order.tableId)}>
            查看桌位
          </button>
        )}
        <button
          className="button button-small"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await actions.rejectCustomerOrder(order.id);
              notify(`已退回 ${order.tableName} #${orderCode(order.id)}`);
            }, '退回失敗')
          }
        >
          退回
        </button>
      </div>
    </div>
  );
}

function ApprovalsPanel() {
  const { live } = useApp();
  const voids = voidRequests(live.state);
  const discounts = discountRequests(live.state);
  return (
    <Panel title="待主管核准" count={voids.length + discounts.length}>
      {voids.length + discounts.length === 0 ? (
        <p className="empty-note">服務員申請取消已送廚的品項或折扣時，會在這裡等待核准</p>
      ) : (
        <>
          {voids.map((lineVoid) => (
            <VoidRequestRow key={lineVoid.id} lineVoid={lineVoid} />
          ))}
          {discounts.map(({ check, discount }) => (
            <DiscountRequestRow key={discount.id} check={check} discount={discount} />
          ))}
        </>
      )}
    </Panel>
  );
}

function DiscountRequestRow({ check, discount }: { check: GuestCheck; discount: Discount }) {
  const { live, actions, notify } = useApp();
  const { busy, run } = useAction();
  const line = discount.lineKey ? billFor(live.state, check).byKey[discount.lineKey] : undefined;
  const decide = (approve: boolean) =>
    run(async () => {
      await actions.decideDiscount(check.id, discount.id, approve);
      notify(approve ? `已核准 ${check.tableName} 的折扣` : `已駁回 ${check.tableName} 的折扣`);
    }, '處理折扣申請失敗');
  return (
    <div className="ready-row ready-row-stack">
      <div>
        <strong>{check.tableName}</strong> 折扣：{line ? `${line.line.name} × ${line.line.quantity} ` : '整單'}
        {describeDiscount(discount)}
        <div className="line-options">
          原因：{discount.reason}・{discount.requestedBy}
        </div>
      </div>
      <div className="chip-row">
        <button className="button button-primary button-small" disabled={busy} onClick={() => decide(true)}>
          核准折扣
        </button>
        <button className="button button-small" disabled={busy} onClick={() => decide(false)}>
          駁回
        </button>
      </div>
    </div>
  );
}

export function VoidRequestRow({ lineVoid }: { lineVoid: LineVoid }) {
  const { live, actions, notify } = useApp();
  const { busy, run } = useAction();
  const ticket = live.state.tickets[lineVoid.ticketId];
  const line = ticket?.lines.find((candidate) => candidate.id === lineVoid.lineId);
  const decide = (approve: boolean) =>
    run(async () => {
      await actions.decideVoid(lineVoid.id, approve);
      notify(approve ? `已核准取消 ${line?.name ?? '品項'}` : `已駁回取消 ${line?.name ?? '品項'}`);
    }, '處理取消申請失敗');
  return (
    <div className="ready-row ready-row-stack">
      <div>
        <strong>{ticket?.tableName}</strong> {line ? `${line.name} × ${line.quantity}` : '品項'}
        {line && ` ${formatMoney(lineAmount(line))}`}
        <div className="line-options">
          原因：{lineVoid.reason}・{lineVoid.requestedBy}
        </div>
      </div>
      <div className="chip-row">
        <button className="button button-danger button-small" disabled={busy} onClick={() => decide(true)}>
          核准取消
        </button>
        <button className="button button-small" disabled={busy} onClick={() => decide(false)}>
          駁回
        </button>
      </div>
    </div>
  );
}

function ReadyPanel() {
  const { live } = useApp();
  const rounds = readyRounds(live.state);
  return (
    <Panel title="可上菜" count={rounds.length}>
      {rounds.length === 0 ? (
        <p className="empty-note">一輪的每個出餐站都完成後，會顯示在這裡</p>
      ) : (
        rounds.map((round) => <ReadyRound key={round.key} round={round} />)
      )}
    </Panel>
  );
}

export function ServeButton({ round, wide }: { round: Round; wide?: boolean }) {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  return (
    <button
      className={`button button-primary ${wide ? 'button-wide' : 'button-small'}`}
      disabled={busy}
      onClick={() =>
        run(async () => {
          await actions.serveTickets(round.tickets.map((ticket) => ticket.id));
          notify(`${round.tableName} 第 ${round.round} 輪${round.course > 0 ? COURSE_LABEL[round.course] : ''}已上菜`);
        }, '更新上菜狀態失敗')
      }
    >
      已上菜
    </button>
  );
}

function ReadyRound({ round }: { round: Round }) {
  const { live } = useApp();
  const lines = round.tickets
    .filter((ticket) => !isFullyVoided(live.state, ticket))
    .flatMap((ticket) => ticket.lines);
  return (
    <div className="ready-row">
      <div>
        <strong>{round.tableName}</strong> 第 {round.round} 輪{round.course > 0 && `・${COURSE_LABEL[round.course]}`}
        <div className="line-options">{lines.map((line) => `${line.name}×${line.quantity}`).join('、')}</div>
      </div>
      <ServeButton round={round} />
    </div>
  );
}

function BillRequestsPanel() {
  const { live } = useApp();
  const goToTable = useGoToTable();
  const now = useNow();
  const checks = billRequests(live.state);
  return (
    <Panel title="請結帳" count={checks.length}>
      {checks.length === 0 ? (
        <p className="empty-note">服務員請求結帳的桌位會顯示在這裡</p>
      ) : (
        checks.map((check) => (
          <div key={check.id} className="ready-row">
            <div>
              <strong>{check.tableName}</strong> 未付 {formatMoney(balanceOf(check))}
              <div className="line-options">{elapsedMinutes(check.billRequestedAt ?? check.openedAt, now)} 分鐘前請求</div>
            </div>
            <button className="button button-primary button-small" onClick={() => goToTable(check.tableId)}>
              結帳
            </button>
          </div>
        ))
      )}
    </Panel>
  );
}
