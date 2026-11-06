import { useState } from 'react';
import { useAction, useApp } from '../appContext';
import {
  formatMoney,
  lineAmount,
  openTakeoutTickets,
  TAKEOUT_TABLE_ID,
  voidId,
  type KitchenTicket,
  type TicketLine,
  type TicketStatus,
} from '../domain';
import { LineDetails } from '../ui/LineDetails';
import { Modal } from '../ui/Modal';
import { Stepper } from '../ui/ItemDialog';
import { MenuPanel, PayDialog, VoidDialog } from './TableView';

/** Takeout lines are drafted under this key, apart from any table's. */
const DRAFT_KEY = 'takeout';

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: '等待製作',
  PREPARING: '製作中',
  READY: '可取餐',
  SERVED: '已取餐',
};

export function TakeoutView() {
  const { catalog, role } = useApp();
  if (!catalog.tables.some((table) => table.id === TAKEOUT_TABLE_ID)) {
    return (
      <div className="seed-prompt">
        <h1>還沒有外帶入口</h1>
        <p>
          {role === 'MANAGER'
            ? '請到 QR Code 頁建立外帶入口，就能在這裡點外帶，也能讓顧客掃碼點外帶。'
            : '請店長到 QR Code 頁建立外帶入口。'}
        </p>
      </div>
    );
  }
  return (
    <div className="table-view">
      <MenuPanel draftKey={DRAFT_KEY} />
      <TakeoutPanel />
    </div>
  );
}

function TakeoutPanel() {
  const { live, drafts, setDraft } = useApp();
  const [paying, setPaying] = useState(false);
  const [issued, setIssued] = useState<number>();
  const draft = drafts[DRAFT_KEY];
  const lines = draft?.lines ?? [];
  const total = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const open = openTakeoutTickets(live.state);

  const updateLine = (lineId: string, quantity: number) => {
    if (!draft) return;
    const next =
      quantity === 0
        ? draft.lines.filter((line) => line.id !== lineId)
        : draft.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line));
    setDraft(DRAFT_KEY, next.length > 0 ? { orderId: crypto.randomUUID(), lines: next } : undefined);
  };

  return (
    <section className="bill-panel" aria-label="外帶">
      <header className="bill-header">
        <h1>外帶</h1>
        <a className="link-button" href="#/pickup" target="_blank" rel="noreferrer">開啟叫號螢幕</a>
      </header>

      <div className="bill-scroll">
        {lines.length > 0 ? (
          <div className="bill-group bill-draft">
            <h2>這位顧客</h2>
            <ul className="bill-lines">
              {lines.map((line) => (
                <li key={line.id}>
                  <div className="bill-line-main">
                    <span>{line.name}</span>
                    <span>{formatMoney(lineAmount(line))}</span>
                  </div>
                  <LineDetails line={line} />
                  <div className="bill-line-tools">
                    <Stepper value={line.quantity} min={0} label={line.name} onChange={(q) => updateLine(line.id, q)} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="empty-note">從左邊選擇菜色，收款後會給顧客取餐號</p>
        )}

        <h2 className="section-title takeout-open-title">
          製作中的外帶 {open.length > 0 && <span className="count">{open.length}</span>}
        </h2>
        {open.length === 0 && <p className="empty-note">目前沒有等待取餐的外帶</p>}
        {open.map((ticket) => (
          <TakeoutTicket key={ticket.id} ticket={ticket} />
        ))}
      </div>

      {lines.length > 0 && (
        <footer className="bill-footer">
          <button className="button button-primary button-wide" onClick={() => setPaying(true)}>
            收款並送廚（{formatMoney(total)}）
          </button>
        </footer>
      )}

      {paying && draft && (
        <PayDialog
          draftKey={DRAFT_KEY}
          tableId={TAKEOUT_TABLE_ID}
          title="外帶收款"
          total={total}
          onPaid={setIssued}
          onClose={() => setPaying(false)}
        />
      )}
      {issued != null && (
        <Modal
          title="已收款並送廚"
          onClose={() => setIssued(undefined)}
          footer={
            <button className="button button-primary button-wide" onClick={() => setIssued(undefined)}>
              下一位
            </button>
          }
        >
          <p className="pickup-issued-label">請告知顧客取餐號</p>
          <div className="pickup-issued">{issued}</div>
        </Modal>
      )}
    </section>
  );
}

function TakeoutTicket({ ticket }: { ticket: KitchenTicket }) {
  const { live, actions } = useApp();
  const { busy, run } = useAction();
  const [voiding, setVoiding] = useState<TicketLine>();

  return (
    <div className="bill-group takeout-ticket">
      <h2>
        #{ticket.pickupNumber}
        <span className={`status-pill status-${ticket.status.toLowerCase()}`}>{STATUS_LABEL[ticket.status]}</span>
      </h2>
      <ul className="bill-lines">
        {ticket.lines.map((line) => {
          const lineVoid = live.state.voids[voidId(ticket.id, line.id)];
          return (
            <li key={line.id} className={lineVoid ? 'is-voided' : ''}>
              <div className="bill-line-main">
                <span>{line.name} × {line.quantity}</span>
                <span className="bill-amount">{formatMoney(lineAmount(line))}</span>
              </div>
              <LineDetails line={line} />
              {lineVoid ? (
                <div className="void-flag">已取消：{lineVoid.reason}</div>
              ) : (
                <button className="link-button link-danger" onClick={() => setVoiding(line)}>
                  取消品項
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {ticket.status === 'READY' && (
        <button
          className="button button-primary button-wide"
          disabled={busy}
          onClick={() => run(() => actions.setTicketStatus(ticket, 'SERVED'), '更新取餐狀態失敗')}
        >
          #{ticket.pickupNumber} 已取餐
        </button>
      )}
      {voiding && <VoidDialog ticket={ticket} line={voiding} onClose={() => setVoiding(undefined)} />}
    </div>
  );
}
