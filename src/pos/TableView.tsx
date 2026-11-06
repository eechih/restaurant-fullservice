import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { failureText, useAction, useApp, type DraftLine } from '../appContext';
import {
  balanceOf,
  billedLine,
  buildLine,
  clockTime,
  formatMoney,
  lineAmount,
  lineKey,
  MAX_SPLIT_PARTS,
  PAYMENT_LABEL,
  paymentAmount,
  paymentsForCheck,
  roundsForCheck,
  roundStatus,
  sharesLeft,
  stationName,
  VOID_REASONS,
  voidId,
  type GuestCheck,
  type KitchenTicket,
  type MenuItem,
  type OptionSelection,
  type PaymentKind,
  type PaymentMethod,
  type PaymentRequest,
  type RoundStatus,
  type TicketLine,
} from '../domain';
import { ItemDialog, Stepper } from '../ui/ItemDialog';
import { LineDetails } from '../ui/LineDetails';
import { Modal } from '../ui/Modal';

export const ROUND_STATUS_LABEL: Record<RoundStatus, string> = {
  NEW: '等待製作',
  PREPARING: '製作中',
  READY: '可上菜',
  SERVED: '已上菜',
  VOIDED: '已取消',
};

function useGoToFloor() {
  const navigate = useNavigate();
  return () => void navigate({ to: '/pos' });
}

export function TableView({ tableId }: { tableId: string }) {
  const { catalog, live, can } = useApp();
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

  const ordering = check.status === 'OPEN' && can('order');
  return (
    <div className={ordering ? 'table-view' : 'table-view table-view-bill'}>
      {ordering && <MenuPanel draftKey={check.id} />}
      <BillPanel check={check} />
    </div>
  );
}

function buildDraftLine(item: MenuItem, selection: OptionSelection, quantity: number, note: string): DraftLine {
  return {
    ...buildLine(crypto.randomUUID(), item, selection, quantity, note),
    choiceIds: Object.values(selection).flat(),
  };
}

/** The menu to order from. Lines go to the check's draft. */
function MenuPanel({ draftKey }: { draftKey: string }) {
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
              item.optionGroups.length > 0 ? setConfiguring(item) : addLine(buildDraftLine(item, {}, 1, ''))
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
  const { catalog, live, drafts, setDraft, actions, notify, can } = useApp();
  const goToFloor = useGoToFloor();
  const { busy, run } = useAction();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<{ ticket: KitchenTicket; line: TicketLine }>();

  const isOpen = check.status === 'OPEN';
  const draft = drafts[check.id];
  const draftLines = draft?.lines ?? [];
  const rounds = roundsForCheck(live.state, check.id);
  const draftTotal = draftLines.reduce((sum, line) => sum + lineAmount(line), 0);
  const unserved = rounds.filter((round) => {
    const status = roundStatus(live.state, round.tickets);
    return status !== 'SERVED' && status !== 'VOIDED';
  });
  const balance = balanceOf(check);
  // Once someone has paid, cancelling would mean a refund, so it is not offered.
  const canVoid = isOpen && check.paidTotal === 0 && can('order');

  const updateDraftLine = (lineId: string, quantity: number) => {
    if (!draft) return;
    const lines =
      quantity === 0
        ? draft.lines.filter((line) => line.id !== lineId)
        : draft.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line));
    setDraft(check.id, lines.length > 0 ? { orderId: crypto.randomUUID(), lines } : undefined);
  };

  const send = () =>
    run(async () => {
      if (!draft) return;
      await actions.sendOrder({
        orderId: draft.orderId,
        checkId: check.id,
        items: draft.lines.map(({ menuItemId, quantity, choiceIds, note }) => ({ menuItemId, quantity, choiceIds, note })),
        expectedTotal: draftTotal,
      });
      setDraft(check.id, undefined);
      notify(`${check.tableName} 已送廚`);
    }, '送廚失敗');

  const write = (action: () => Promise<void>, done: string, failure: string, leave = false) =>
    run(async () => {
      await action();
      notify(done);
      if (leave) goToFloor();
    }, failure);

  return (
    <section className="bill-panel" aria-label="帳單">
      <header className="bill-header">
        <button className="link-button" onClick={goToFloor}>← 桌位</button>
        <h1>{check.tableName}</h1>
        <span className="table-meta">
          {check.partyName && `${check.partyName}・`}
          {check.guestCount ? `${check.guestCount} 人・` : ''}
          {clockTime(check.openedAt)} 入座
        </span>
        {!isOpen && <span className="badge badge-warn">已結帳，待清理</span>}
        {isOpen && check.billRequestedAt && <span className="badge badge-warn">已請求結帳</span>}
      </header>

      <div className="bill-scroll">
        {draftLines.length > 0 && (
          <div className="bill-group bill-draft">
            <h2>尚未送廚</h2>
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

        {[...rounds].reverse().map((round) => {
          const status = roundStatus(live.state, round.tickets);
          return (
            <div key={round.orderId} className="bill-group">
              <h2>
                第 {round.round} 輪・{clockTime(round.sentAt)}
                <span className={`status-pill status-${status.toLowerCase()}`}>{ROUND_STATUS_LABEL[status]}</span>
              </h2>
              <ul className="bill-lines">
                {round.tickets.flatMap((ticket) =>
                  ticket.lines.map((line) => {
                    const lineVoid = live.state.voids[voidId(ticket.id, line.id)];
                    const paid = check.paidLineKeys.includes(lineKey(ticket.id, line.id));
                    return (
                      <li key={line.id} className={lineVoid?.status === 'APPROVED' ? 'is-voided' : ''}>
                        <div className="bill-line-main">
                          <span>{line.name} × {line.quantity}</span>
                          <span className="bill-amount">{formatMoney(lineAmount(line))}</span>
                        </div>
                        <LineDetails line={line} />
                        <div className="line-station">
                          {stationName(catalog, ticket.stationId)}・{ROUND_STATUS_LABEL[ticket.status]}
                          {paid && <span className="badge badge-ok">已付</span>}
                        </div>
                        {lineVoid?.status === 'APPROVED' ? (
                          <div className="void-flag">已取消：{lineVoid.reason}</div>
                        ) : lineVoid?.status === 'REQUESTED' ? (
                          <div className="void-flag void-pending">申請取消中：{lineVoid.reason}，等待主管核准</div>
                        ) : (
                          <>
                            {lineVoid?.status === 'REJECTED' && (
                              <div className="line-note">取消申請已被{lineVoid.decidedBy}駁回</div>
                            )}
                            {canVoid && (
                              <button
                                className="link-button link-danger"
                                onClick={() => setVoiding({ ticket, line })}
                              >
                                {can('approveVoid') ? '取消品項' : '申請取消'}
                              </button>
                            )}
                          </>
                        )}
                      </li>
                    );
                  }),
                )}
              </ul>
            </div>
          );
        })}

        {rounds.length === 0 && draftLines.length === 0 && (
          <p className="empty-note">{can('order') ? '從左邊選擇菜色開始點餐' : '這桌還沒有點餐'}</p>
        )}
      </div>

      <footer className="bill-footer">
        <div className="bill-total">
          <span>帳單合計</span>
          <strong>{formatMoney(check.billTotal)}</strong>
        </div>
        {check.paidTotal > 0 && (
          <div className="bill-total bill-total-small">
            <span>已付 {formatMoney(check.paidTotal)}</span>
            <span>未付 {formatMoney(balance)}</span>
          </div>
        )}

        {!isOpen ? (
          can('clearTable') && (
            <button
              className="button button-primary button-wide"
              disabled={busy}
              onClick={() =>
                write(() => actions.markTableCleaned(check.tableId), `${check.tableName} 已清理`, '更新桌況失敗', true)
              }
            >
              已清理，可以帶位
            </button>
          )
        ) : draftLines.length > 0 && can('order') ? (
          <button className="button button-primary button-wide" disabled={busy} onClick={send}>
            送廚（{formatMoney(draftTotal)}）
          </button>
        ) : rounds.length === 0 ? (
          can('openTable') && (
            <button
              className="button button-wide"
              disabled={busy}
              onClick={() => write(() => actions.cancelTable(check.id), '已取消開桌', '取消開桌失敗', true)}
            >
              客人離開，取消開桌
            </button>
          )
        ) : (
          <>
            {unserved.length > 0 && (
              <p className="warning-note">還有 {unserved.length} 輪尚未上菜。</p>
            )}
            <div className="bill-actions">
              {can('order') && !check.billRequestedAt && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    write(() => actions.requestBill(check.id), `已通知櫃台 ${check.tableName} 要結帳`, '請求結帳失敗')
                  }
                >
                  請求結帳
                </button>
              )}
              {can('checkout') &&
                (balance > 0 ? (
                  <button className="button button-primary" disabled={busy} onClick={() => setPaying(true)}>
                    結帳
                  </button>
                ) : (
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => write(() => actions.closeCheck(check.id), `${check.tableName} 已結帳`, '結帳失敗')}
                  >
                    結束帳單（不需收款）
                  </button>
                ))}
            </div>
          </>
        )}
      </footer>

      {paying && <CheckoutDialog checkId={check.id} onClose={() => setPaying(false)} />}
      {voiding && <VoidDialog ticket={voiding.ticket} line={voiding.line} onClose={() => setVoiding(undefined)} />}
    </section>
  );
}

const KIND_LABEL: Record<PaymentKind, string> = {
  BALANCE: '付清',
  LINES: '依品項',
  SHARE: '平均分攤',
  AMOUNT: '自訂金額',
};

/**
 * Takes one or more payments for a check. It stays open between them, so that a
 * table splitting the bill can pay one after another.
 */
function CheckoutDialog({ checkId, onClose }: { checkId: string; onClose(): void }) {
  const { live, actions, notify } = useApp();
  const { busy, run } = useAction();
  const check = live.state.checks[checkId];
  const payments = paymentsForCheck(live.state, checkId);
  const [kind, setKind] = useState<PaymentKind>('BALANCE');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [parts, setParts] = useState(() => sharesLeft(payments) ?? Math.max(2, check?.guestCount ?? 2));
  const [amountText, setAmountText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // Kept while the same payment is retried, so that a timeout cannot charge twice.
  const pending = useRef<{ signature: string; id: string } | undefined>(undefined);

  const closed = check?.status !== 'OPEN';
  useEffect(() => {
    if (!closed) return;
    if (check) notify(`${check.tableName} 已結帳，桌位待清理`);
    onClose();
  }, [closed, check, notify, onClose]);
  if (!check || closed) return null;

  const balance = balanceOf(check);
  const request: PaymentRequest =
    kind === 'AMOUNT'
      ? { kind, amount: amountText.trim() === '' ? Number.NaN : Number(amountText) }
      : kind === 'SHARE'
        ? { kind, parts }
        : kind === 'LINES'
          ? { kind, lineKeys: selected }
          : { kind };
  let estimate: number | undefined;
  let problem: string | undefined;
  try {
    estimate = paymentAmount(check, request, (key) => billedLine(live.state, checkId, key)?.amount).amount;
  } catch (error) {
    problem = failureText(error, '金額有誤');
  }

  const unpaidLines = roundsForCheck(live.state, checkId).flatMap((round) =>
    round.tickets.flatMap((ticket) =>
      ticket.lines.flatMap((line) => {
        const key = lineKey(ticket.id, line.id);
        const billed = billedLine(live.state, checkId, key);
        return billed && !check.paidLineKeys.includes(key) ? [{ key, line, amount: billed.amount }] : [];
      }),
    ),
  );

  const pay = () =>
    run(async () => {
      if (estimate === undefined) return;
      const signature = JSON.stringify({ request, method, estimate, paid: check.paidTotal });
      if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      await actions.recordPayment({ paymentId: pending.current.id, checkId, method, expectedAmount: estimate, ...request });
      pending.current = undefined;
      notify(`已收${PAYMENT_LABEL[method]} ${formatMoney(estimate)}`);
      setSelected([]);
      setAmountText('');
      if (kind === 'SHARE') setParts((current) => Math.max(1, current - 1));
    }, '收款失敗');

  return (
    <Modal
      title={`${check.tableName} 結帳`}
      onClose={onClose}
      footer={
        <>
          {problem && kind !== 'BALANCE' && <p className="warning-note">{problem}</p>}
          <button className="button button-primary button-wide" disabled={busy || estimate === undefined} onClick={pay}>
            收{PAYMENT_LABEL[method]} {estimate !== undefined ? formatMoney(estimate) : ''}
          </button>
        </>
      }
    >
      <div className="checkout-summary">
        <div>
          <span>帳單</span>
          <strong>{formatMoney(check.billTotal)}</strong>
        </div>
        <div>
          <span>已付</span>
          <strong>{formatMoney(check.paidTotal)}</strong>
        </div>
        <div className="checkout-due">
          <span>未付</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
      </div>
      {payments.length > 0 && (
        <ul className="checkout-payments">
          {payments.map((payment) => (
            <li key={payment.id}>
              {clockTime(payment.paidAt)} {PAYMENT_LABEL[payment.method]} {formatMoney(payment.amount)}
              <span className="field-hint">{KIND_LABEL[payment.kind]}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="field-label">付款方式</p>
      <div className="chip-row">
        {(['BALANCE', 'LINES', 'SHARE', 'AMOUNT'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={kind === value}
            className={kind === value ? 'chip is-selected' : 'chip'}
            onClick={() => setKind(value)}
          >
            {KIND_LABEL[value]}
          </button>
        ))}
      </div>

      {kind === 'LINES' && (
        <fieldset className="checkout-lines">
          <legend className="field-label">勾選這位客人點的品項</legend>
          {unpaidLines.length === 0 && <p className="empty-note">沒有尚未付款的品項</p>}
          {unpaidLines.map(({ key, line, amount }) => (
            <label key={key} className="checkbox checkout-line">
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, key] : current.filter((candidate) => candidate !== key),
                  )
                }
              />
              <span>{line.name} × {line.quantity}</span>
              <span>{formatMoney(amount)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {kind === 'SHARE' && (
        <>
          <p className="field-label">還有幾位要分攤</p>
          <Stepper value={parts} min={1} label="分攤人數" onChange={(value) => setParts(Math.min(MAX_SPLIT_PARTS, value))} />
          {estimate !== undefined && <p className="field-hint">這一位付 {formatMoney(estimate)}，有零頭時由先付的人多付 1 元</p>}
        </>
      )}
      {kind === 'AMOUNT' && (
        <>
          <label className="field-label" htmlFor="payment-amount">這次收多少</label>
          <input
            id="payment-amount"
            className="text-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={balance}
            step={1}
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
          <p className="field-hint">例如部分付現金、其餘刷卡</p>
        </>
      )}

      <p className="field-label">收款方式</p>
      <div className="chip-row">
        {(['CASH', 'CARD'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={method === value}
            className={method === value ? 'chip is-selected' : 'chip'}
            onClick={() => setMethod(value)}
          >
            {PAYMENT_LABEL[value]}
          </button>
        ))}
      </div>
      <p className="field-hint">這裡只記錄收款，不會實際刷卡。付清後桌位會變成待清理。</p>
    </Modal>
  );
}

function VoidDialog({ ticket, line, onClose }: { ticket: KitchenTicket; line: TicketLine; onClose(): void }) {
  const { actions, notify, can } = useApp();
  const { busy, run } = useAction();
  const [reason, setReason] = useState<string>();
  const approver = can('approveVoid');

  const confirm = () =>
    run(async () => {
      if (!reason) return;
      await actions.requestVoid({ ticketId: ticket.id, lineId: line.id, reason });
      notify(approver ? `已取消 ${line.name}` : `已送出取消 ${line.name} 的申請，等待主管核准`);
      onClose();
    }, '取消品項失敗');

  return (
    <Modal
      title={`${approver ? '取消' : '申請取消'} ${line.name} × ${line.quantity}`}
      onClose={onClose}
      footer={
        <button className="button button-danger button-wide" disabled={busy || !reason} onClick={confirm}>
          {!reason ? '請選擇原因' : approver ? '確認取消品項' : '送出申請'}
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
        {approver
          ? `取消後帳單會減少 ${formatMoney(lineAmount(line))}，廚房畫面會顯示已取消。`
          : '這道菜已經送廚。主管核准後才會從帳單移除，廚房畫面會先標示「申請取消中」。'}
      </p>
    </Modal>
  );
}
