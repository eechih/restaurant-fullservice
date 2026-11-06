import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAction, useApp, type DraftLine } from '../appContext';
import {
  billTotal,
  buildLine,
  formatMoney,
  isFullyVoided,
  lineAmount,
  OrderRejectedError,
  ticketsForCheck,
  unservedTickets,
  voidId,
  type GuestCheck,
  type KitchenTicket,
  type MenuItem,
  type OptionSelection,
  type PaymentMethod,
  type TicketLine,
  type TicketStatus,
} from '../domain';
import { ItemDialog, Stepper } from '../ui/ItemDialog';
import { LineDetails } from '../ui/LineDetails';
import { Modal } from '../ui/Modal';

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: '等待製作',
  PREPARING: '製作中',
  READY: '可上菜',
  SERVED: '已上菜',
};
const VOID_REASONS = ['點錯', '客人取消', '缺料', '其他'];

function useGoToFloor() {
  const navigate = useNavigate();
  return () => void navigate({ to: '/pos' });
}

export function TableView({ tableId }: { tableId: string }) {
  const { catalog, live } = useApp();
  const goToFloor = useGoToFloor();
  const table = catalog.tables.find((candidate) => candidate.id === tableId);
  const check = live.state.checks[live.state.seatings[tableId]?.checkId];

  if (!table || !check) {
    return (
      <div className="seed-prompt">
        <h1>{live.loaded ? '這桌目前沒有開桌' : '載入中…'}</h1>
        {live.loaded && <button className="button" onClick={goToFloor}>回到桌位</button>}
      </div>
    );
  }

  return (
    <div className="table-view">
      <MenuPanel draftKey={check.id} />
      <BillPanel check={check} />
    </div>
  );
}

function buildDraftLine(
  item: MenuItem,
  selection: OptionSelection,
  quantity: number,
  note: string,
): DraftLine {
  return {
    ...buildLine(crypto.randomUUID(), item, selection, quantity, note),
    choiceIds: Object.values(selection).flat(),
  };
}

/** The menu to order from. Lines go to the draft under draftKey: a check, or takeout. */
export function MenuPanel({ draftKey }: { draftKey: string }) {
  const { catalog, drafts, setDraft } = useApp();
  const [categoryId, setCategoryId] = useState(catalog.categories[0]?.id);
  const [configuring, setConfiguring] = useState<MenuItem>();
  const items = catalog.items.filter((item) => item.categoryId === categoryId);

  const addLine = (line: DraftLine) => {
    const lines = drafts[draftKey]?.lines ?? [];
    setDraft(draftKey, { orderId: crypto.randomUUID(), lines: [...lines, line] });
  };

  return (
    <section className="menu-panel" aria-label="菜單">
      <div className="tabs" role="tablist">
        {catalog.categories.map((category) => (
          <button
            key={category.id}
            role="tab"
            aria-selected={category.id === categoryId}
            className={category.id === categoryId ? 'tab is-selected' : 'tab'}
            onClick={() => setCategoryId(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>
      <div className="item-grid">
        {items.map((item) => (
          <button
            key={item.id}
            className="item-card"
            disabled={item.available === false}
            onClick={() =>
              item.optionGroups.length > 0
                ? setConfiguring(item)
                : addLine(buildDraftLine(item, {}, 1, ''))
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
      {configuring && (
        <ItemDialog
          item={configuring}
          onClose={() => setConfiguring(undefined)}
          onAdd={(selection, quantity, note) => {
            addLine(buildDraftLine(configuring, selection, quantity, note));
            setConfiguring(undefined);
          }}
        />
      )}
    </section>
  );
}

function BillPanel({ check }: { check: GuestCheck }) {
  const { live, drafts, setDraft, actions, notify } = useApp();
  const goToFloor = useGoToFloor();
  const { busy, run } = useAction();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<{ ticket: KitchenTicket; line: TicketLine }>();

  const draft = drafts[check.id];
  const draftLines = draft?.lines ?? [];
  const tickets = ticketsForCheck(live.state, check.id);
  const total = billTotal(live.state, check.id);
  const draftTotal = draftLines.reduce((sum, line) => sum + lineAmount(line), 0);
  const unserved = unservedTickets(live.state, check.id);

  const updateDraftLine = (lineId: string, quantity: number) => {
    if (!draft) return;
    const lines =
      quantity === 0
        ? draft.lines.filter((line) => line.id !== lineId)
        : draft.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line));
    setDraft(check.id, lines.length > 0 ? { orderId: crypto.randomUUID(), lines } : undefined);
  };

  const leave = (message: string) =>
    run(async () => {
      await actions.clearTable(check.tableId);
      notify(message);
      goToFloor();
    }, '更新桌位失敗');

  return (
    <section className="bill-panel" aria-label="帳單">
      <header className="bill-header">
        <button className="link-button" onClick={goToFloor}>← 桌位</button>
        <h1>{check.tableName}</h1>
        {check.guestCount && <span className="table-meta">{check.guestCount} 人</span>}
      </header>

      <div className="bill-scroll">
        {draftLines.length > 0 && (
          <div className="bill-group bill-draft">
            <h2>尚未收款</h2>
            <ul className="bill-lines">
              {draftLines.map((line) => (
                <li key={line.id}>
                  <div className="bill-line-main">
                    <span>{line.name}</span>
                    <span>{formatMoney(lineAmount(line))}</span>
                  </div>
                  <LineDetails line={line} />
                  <div className="bill-line-tools">
                    <Stepper
                      value={line.quantity}
                      min={0}
                      label={line.name}
                      onChange={(quantity) => updateDraftLine(line.id, quantity)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tickets.map((ticket) => (
          <div key={ticket.id} className="bill-group">
            <h2>
              第 {ticket.round} 輪
              <span className={`status-pill status-${ticket.status.toLowerCase()}`}>
                {isFullyVoided(live.state, ticket) ? '已取消' : STATUS_LABEL[ticket.status]}
              </span>
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
                      <button className="link-button link-danger" onClick={() => setVoiding({ ticket, line })}>
                        取消品項
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {tickets.length === 0 && draftLines.length === 0 && (
          <p className="empty-note">從左邊選擇菜色開始點餐</p>
        )}
      </div>

      <footer className="bill-footer">
        <div className="bill-total">
          <span>已收款合計</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        {draftLines.length > 0 ? (
          <button className="button button-primary button-wide" disabled={busy} onClick={() => setPaying(true)}>
            收款並送廚（{formatMoney(draftTotal)}）
          </button>
        ) : tickets.length === 0 ? (
          <button className="button button-wide" disabled={busy} onClick={() => leave('已取消開桌')}>
            取消開桌
          </button>
        ) : (
          <>
            {unserved.length > 0 && (
              <p className="warning-note">還有 {unserved.length} 張工作單尚未上菜，清桌後廚房仍會繼續製作。</p>
            )}
            <button className="button button-primary button-wide" disabled={busy} onClick={() => leave('已清桌')}>
              清桌
            </button>
          </>
        )}
      </footer>

      {paying && draft && (
        <PayDialog
          draftKey={check.id}
          tableId={check.tableId}
          title={`${check.tableName} 收款`}
          total={draftTotal}
          onPaid={() => notify(`${check.tableName} 已收款並送廚`)}
          onClose={() => setPaying(false)}
        />
      )}
      {voiding && (
        <VoidDialog
          ticket={voiding.ticket}
          line={voiding.line}
          onClose={() => setVoiding(undefined)}
        />
      )}
    </section>
  );
}

/** Takes payment for the draft under draftKey and sends it to the kitchen. */
export function PayDialog({
  draftKey,
  tableId,
  title,
  total,
  onPaid,
  onClose,
}: {
  draftKey: string;
  tableId: string;
  title: string;
  total: number;
  /** Receives the pickup number, for takeout. */
  onPaid(pickupNumber?: number): void;
  onClose(): void;
}) {
  const { drafts, setDraft, actions } = useApp();
  const { busy, run } = useAction();
  const [method, setMethod] = useState<PaymentMethod>('CASH');

  const pay = () =>
    run(async () => {
      const draft = drafts[draftKey];
      if (!draft) return;
      let pickupNumber: number | undefined;
      try {
        pickupNumber = await actions.placeAndPay(
          {
            orderId: draft.orderId,
            tableId,
            items: draft.lines.map(({ menuItemId, quantity, choiceIds, note }) => ({
              menuItemId,
              quantity,
              choiceIds,
              note,
            })),
            expectedTotal: total,
          },
          method,
        );
      } catch (error) {
        // An expired order id can never succeed, so a retry needs a new one.
        if (error instanceof OrderRejectedError && error.code === 'ORDER_EXPIRED') {
          setDraft(draftKey, { ...draft, orderId: crypto.randomUUID() });
        }
        throw error;
      }
      setDraft(draftKey, undefined);
      onPaid(pickupNumber);
      onClose();
    }, '收款失敗');

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy} onClick={pay}>
          確認收款並送廚 {formatMoney(total)}
        </button>
      }
    >
      <div className="pay-total">{formatMoney(total)}</div>
      <p className="field-label">付款方式</p>
      <div className="chip-row">
        {(
          [
            ['CASH', '現金'],
            ['CARD', '刷卡'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={method === value}
            className={method === value ? 'chip is-selected' : 'chip'}
            onClick={() => setMethod(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="field-hint">這裡只記錄付款方式，不會實際收款。</p>
    </Modal>
  );
}

export function VoidDialog({
  ticket,
  line,
  onClose,
}: {
  ticket: KitchenTicket;
  line: TicketLine;
  onClose(): void;
}) {
  const { actions, notify } = useApp();
  const { busy, run } = useAction();
  const [reason, setReason] = useState<string>();

  const confirm = () =>
    run(async () => {
      if (!reason) return;
      await actions.voidLine({
        id: voidId(ticket.id, line.id),
        ticketId: ticket.id,
        checkId: ticket.checkId,
        lineId: line.id,
        reason,
        voidedAt: new Date().toISOString(),
      });
      notify(`已取消 ${line.name}，請退款 ${formatMoney(lineAmount(line))}`);
      onClose();
    }, '取消品項失敗');

  return (
    <Modal
      title={`取消 ${line.name} × ${line.quantity}`}
      onClose={onClose}
      footer={
        <button className="button button-danger button-wide" disabled={busy || !reason} onClick={confirm}>
          {reason ? '確認取消品項' : '請選擇原因'}
        </button>
      }
    >
      <p className="field-label">取消原因</p>
      <div className="chip-row">
        {VOID_REASONS.map((option) => (
          <button
            key={option}
            aria-pressed={reason === option}
            className={reason === option ? 'chip is-selected' : 'chip'}
            onClick={() => setReason(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <p className="warning-note">
        這筆品項已收款，取消後請手動退款 {formatMoney(lineAmount(line))}。廚房畫面會顯示已取消。
      </p>
    </Modal>
  );
}
