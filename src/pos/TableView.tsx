import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { failureText, useAction, useApp, type DraftLine } from '../appContext';
import {
  balanceOf,
  billFor,
  billOf,
  buildLine,
  CARRIER_LABEL,
  checkInvoice,
  clockTime,
  COURSE_LABEL,
  courseFor,
  COURSES,
  describeDiscount,
  describeInvoice,
  DISCOUNT_REASONS,
  foldLabel,
  formatMoney,
  heldCourses,
  isLineDiscount,
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
  tablesOf,
  tableState,
  VOID_REASONS,
  voidId,
  type CarrierType,
  type Discount,
  type DiscountKind,
  type GuestCheck,
  type InvoiceRequest,
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
  HELD: '待叫菜',
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

function buildDraftLine(
  item: MenuItem,
  selection: OptionSelection,
  quantity: number,
  note: string,
  course: number,
): DraftLine {
  return {
    ...buildLine(crypto.randomUUID(), item, selection, quantity, note),
    choiceIds: Object.values(selection).flat(),
    course,
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
              item.optionGroups.length > 0
                ? setConfiguring(item)
                : addLine(buildDraftLine(item, {}, 1, '', courseFor(catalog, item.id)))
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
            addLine(buildDraftLine(configuring, selection, quantity, note, courseFor(catalog, configuring.id)));
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
  const [discounting, setDiscounting] = useState<{ ticket: KitchenTicket; line: TicketLine } | 'CHECK'>();
  const [arranging, setArranging] = useState<ArrangeMode>();

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
  const bill = billFor(live.state, check);
  // Once someone has paid, changing what is billed would mean a refund, so it is not offered.
  const editable = isOpen && check.paidTotal === 0;
  const checkDiscount = check.discounts.find(
    (discount) => !isLineDiscount(discount.kind) && discount.status !== 'REJECTED',
  );

  const updateDraftLine = (lineId: string, quantity: number) => {
    if (!draft) return;
    const lines =
      quantity === 0
        ? draft.lines.filter((line) => line.id !== lineId)
        : draft.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line));
    setDraft(check.id, lines.length > 0 ? { orderId: crypto.randomUUID(), lines } : undefined);
  };

  const setDraftCourse = (lineId: string, course: number) => {
    if (!draft) return;
    const lines = draft.lines.map((line) => (line.id === lineId ? { ...line, course } : line));
    setDraft(check.id, { orderId: crypto.randomUUID(), lines });
  };
  const held = heldCourses(live.state, check.id);

  const send = () =>
    run(async () => {
      if (!draft) return;
      await actions.sendOrder({
        orderId: draft.orderId,
        checkId: check.id,
        items: draft.lines.map(({ menuItemId, quantity, choiceIds, note, course }) => ({
          menuItemId,
          quantity,
          choiceIds,
          note,
          course,
        })),
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
        {isOpen && can('tables') && (
          <span className="bill-header-tools">
            <button className="link-button" onClick={() => setArranging('MOVE')}>換桌</button>
            <button className="link-button" onClick={() => setArranging('ADD')}>加併桌位</button>
            {check.paidTotal === 0 && (
              <button className="link-button" onClick={() => setArranging('MERGE')}>合併帳單</button>
            )}
          </span>
        )}
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
                    <select
                      className="text-input course-select"
                      aria-label={`${line.name} 上菜順序`}
                      value={line.course ?? 0}
                      onChange={(event) => setDraftCourse(line.id, Number(event.target.value))}
                    >
                      {COURSES.map((course) => (
                        <option key={course} value={course}>
                          {COURSE_LABEL[course]}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Newest round first; within a round, courses in the order they are served. */}
        {[...rounds].sort((a, b) => b.round - a.round || a.course - b.course).map((round) => {
          const status = roundStatus(live.state, round.tickets);
          return (
            <div key={round.key} className="bill-group">
              <h2>
                第 {round.round} 輪{round.course > 0 && `・${COURSE_LABEL[round.course]}`}・{clockTime(round.sentAt)}
                <span className={`status-pill status-${status.toLowerCase()}`}>{ROUND_STATUS_LABEL[status]}</span>
              </h2>
              <ul className="bill-lines">
                {round.tickets.flatMap((ticket) =>
                  ticket.lines.map((line) => {
                    const key = lineKey(ticket.id, line.id);
                    const lineVoid = live.state.voids[voidId(ticket.id, line.id)];
                    const paid = check.paidLineKeys.includes(key);
                    const billed = bill.byKey[key];
                    const discount = check.discounts.find(
                      (candidate) => candidate.lineKey === key && candidate.status !== 'REJECTED',
                    );
                    return (
                      <li key={line.id} className={lineVoid?.status === 'APPROVED' ? 'is-voided' : ''}>
                        <div className="bill-line-main">
                          <span>{line.name} × {line.quantity}</span>
                          <span className="bill-amount">
                            {billed && billed.net !== billed.amount && <s>{formatMoney(billed.amount)}</s>}{' '}
                            {formatMoney(billed?.net ?? lineAmount(line))}
                          </span>
                        </div>
                        <LineDetails line={line} />
                        <div className="line-station">
                          {stationName(catalog, ticket.stationId)}・{ROUND_STATUS_LABEL[ticket.status]}
                          {line.noServiceCharge && check.serviceChargeRate > 0 && <span>・不收服務費</span>}
                          {paid && <span className="badge badge-ok">已付</span>}
                        </div>
                        {lineVoid?.status === 'APPROVED' ? (
                          <div className="void-flag">已取消：{lineVoid.reason}</div>
                        ) : (
                          <>
                            {lineVoid?.status === 'REQUESTED' && (
                              <div className="void-flag void-pending">申請取消中：{lineVoid.reason}，等待主管核准</div>
                            )}
                            {lineVoid?.status === 'REJECTED' && (
                              <div className="line-note">取消申請已被{lineVoid.decidedBy}駁回</div>
                            )}
                            {discount && <DiscountNote check={check} discount={discount} />}
                            {editable && lineVoid?.status !== 'REQUESTED' && (
                              <div className="line-actions">
                                {can('order') && (
                                  <button className="link-button link-danger" onClick={() => setVoiding({ ticket, line })}>
                                    {can('approve') ? '取消品項' : '申請取消'}
                                  </button>
                                )}
                                {can('discount') && !discount && (
                                  <button className="link-button" onClick={() => setDiscounting({ ticket, line })}>
                                    折扣
                                  </button>
                                )}
                              </div>
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
        <BillSummary check={check} />
        {checkDiscount && <DiscountNote check={check} discount={checkDiscount} />}
        {check.paidTotal > 0 && (
          <div className="bill-total bill-total-small">
            <span>已付 {formatMoney(check.paidTotal)}</span>
            <span>未付 {formatMoney(balance)}</span>
          </div>
        )}

        {!isOpen && can('checkout') && (
          <Link className="button button-wide" to="/receipt/$checkId" params={{ checkId: check.id }}>
            列印收據
          </Link>
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
            {held.length > 0 && can('order') && (
              <div className="fire-courses">
                <span>待叫菜：{held.map((course) => COURSE_LABEL[course]).join('、')}</span>
                {held.map((course) => (
                  <button
                    key={course}
                    className="button button-small button-primary"
                    disabled={busy}
                    onClick={() =>
                      write(() => actions.fireCourse(check.id, course), `已叫${COURSE_LABEL[course]}`, '叫菜失敗')
                    }
                  >
                    叫{COURSE_LABEL[course]}
                  </button>
                ))}
              </div>
            )}
            {unserved.length > 0 && (
              <p className="warning-note">還有 {unserved.length} 道尚未上菜。</p>
            )}
            <div className="bill-actions">
              {editable && can('discount') && !checkDiscount && (
                <button className="button" onClick={() => setDiscounting('CHECK')}>
                  整單折扣
                </button>
              )}
              {can('checkout') && (
                <Link className="button" to="/receipt/$checkId" params={{ checkId: check.id }}>
                  收據
                </Link>
              )}
            </div>
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
      {arranging && <ArrangeDialog check={check} mode={arranging} onClose={() => setArranging(undefined)} />}
      {discounting && (
        <DiscountDialog
          check={check}
          target={discounting === 'CHECK' ? undefined : discounting}
          onClose={() => setDiscounting(undefined)}
        />
      )}
    </section>
  );
}

/** Subtotal, discounts and service charge, then what is owed. */
export function BillSummary({ check }: { check: GuestCheck }) {
  const rows: [string, string][] = [];
  if (check.discountTotal > 0 || check.serviceCharge > 0) {
    rows.push(['小計', formatMoney(check.itemsTotal)]);
    if (check.discountTotal > 0) rows.push(['折扣', `−${formatMoney(check.discountTotal)}`]);
    if (check.serviceChargeRate > 0) rows.push([`服務費 ${check.serviceChargeRate}%`, formatMoney(check.serviceCharge)]);
  }
  return (
    <>
      {rows.map(([label, value]) => (
        <div key={label} className="bill-total bill-total-small">
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <div className="bill-total">
        <span>帳單合計</span>
        <strong>{formatMoney(check.billTotal)}</strong>
      </div>
    </>
  );
}

/** A discount on a line or the bill, with a supervisor's buttons when it waits for one. */
function DiscountNote({ check, discount }: { check: GuestCheck; discount: Discount }) {
  const { actions, notify, can } = useApp();
  const { busy, run } = useAction();
  const editable = check.status === 'OPEN' && check.paidTotal === 0;
  const decide = (approve: boolean) =>
    run(async () => {
      await actions.decideDiscount(check.id, discount.id, approve);
      notify(approve ? '已核准折扣' : '已駁回折扣');
    }, '處理折扣失敗');
  return (
    <div className={discount.status === 'REQUESTED' ? 'discount-note is-pending' : 'discount-note'}>
      <span>
        {describeDiscount(discount)}・{discount.reason}
        {discount.status === 'REQUESTED' && `，${discount.requestedBy} 申請，等待主管核准`}
      </span>
      {can('approve') && discount.status === 'REQUESTED' && (
        <span className="chip-row">
          <button className="button button-small button-primary" disabled={busy} onClick={() => decide(true)}>核准</button>
          <button className="button button-small" disabled={busy} onClick={() => decide(false)}>駁回</button>
        </span>
      )}
      {can('approve') && discount.status === 'APPROVED' && editable && (
        <button
          className="link-button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await actions.removeDiscount(check.id, discount.id);
              notify('已取消折扣');
            }, '取消折扣失敗')
          }
        >
          取消折扣
        </button>
      )}
    </div>
  );
}

const PERCENTS = [5, 10, 15, 20, 30, 50];

/** Asks for a discount on a line, or on the whole bill when there is no target. */
function DiscountDialog({
  check,
  target,
  onClose,
}: {
  check: GuestCheck;
  target?: { ticket: KitchenTicket; line: TicketLine };
  onClose(): void;
}) {
  const { live, actions, notify, can } = useApp();
  const { busy, run } = useAction();
  const kinds: [DiscountKind, string][] = target
    ? [
        ['LINE_COMP', '招待'],
        ['LINE_PERCENT', '打折'],
        ['LINE_AMOUNT', '折抵金額'],
      ]
    : [
        ['CHECK_PERCENT', '打折'],
        ['CHECK_AMOUNT', '折抵金額'],
      ];
  const [kind, setKind] = useState<DiscountKind>(kinds[0][0]);
  const [percent, setPercent] = useState(10);
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState<string>();
  const [id] = useState(() => crypto.randomUUID());
  const approver = can('approve');
  const value =
    kind === 'LINE_COMP' ? 0 : kind.endsWith('PERCENT') ? percent : amountText.trim() ? Number(amountText) : Number.NaN;
  const key = target ? lineKey(target.ticket.id, target.line.id) : null;

  // What the bill would come to, to show before asking.
  const tickets = roundsForCheck(live.state, check.id).flatMap((round) => round.tickets);
  const preview = Number.isInteger(value)
    ? billOf(
        {
          ...check,
          discounts: [
            ...check.discounts,
            {
              id,
              kind,
              value,
              lineKey: key,
              reason: '',
              status: 'APPROVED',
              requestedBy: '',
              requestedAt: '',
            },
          ],
        },
        tickets,
        live.state.voids,
      )
    : undefined;

  const submit = () =>
    run(async () => {
      if (!reason) return;
      await actions.requestDiscount(check.id, { id, kind, value, lineKey: key, reason });
      notify(approver ? '已加上折扣' : '已送出折扣申請，等待主管核准');
      onClose();
    }, '折扣失敗');

  return (
    <Modal
      title={target ? `${target.line.name} × ${target.line.quantity} 折扣` : `${check.tableName} 整單折扣`}
      onClose={onClose}
      footer={
        <>
          {preview && <p className="field-hint">折扣後帳單合計 {formatMoney(preview.total)}（原 {formatMoney(check.billTotal)}）</p>}
          <button className="button button-primary button-wide" disabled={busy || !reason || !preview} onClick={submit}>
            {!reason ? '請選擇原因' : approver ? '加上折扣' : '送出申請'}
          </button>
        </>
      }
    >
      <p className="field-label">折扣方式</p>
      <div className="chip-row">
        {kinds.map(([value, label]) => (
          <button
            key={value}
            aria-pressed={kind === value}
            className={kind === value ? 'chip is-selected' : 'chip'}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {kind.endsWith('PERCENT') && (
        <div className="chip-row discount-percents">
          {PERCENTS.map((value) => (
            <button
              key={value}
              aria-pressed={percent === value}
              className={percent === value ? 'chip is-selected' : 'chip'}
              onClick={() => setPercent(value)}
            >
              {foldLabel(value)}
            </button>
          ))}
        </div>
      )}
      {kind.endsWith('AMOUNT') && (
        <>
          <label className="field-label" htmlFor="discount-amount">折抵多少元</label>
          <input
            id="discount-amount"
            className="text-input"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
        </>
      )}
      <p className="field-label">原因</p>
      <div className="chip-row">
        {DISCOUNT_REASONS.map((option) => (
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
      {!approver && <p className="warning-note">折扣要主管核准後才會算進帳單。</p>}
    </Modal>
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
  const [invoiceType, setInvoiceType] = useState<CarrierType | 'DONATE'>('NONE');
  const [carrierId, setCarrierId] = useState('');
  const [buyerTaxId, setBuyerTaxId] = useState('');
  const [donationCode, setDonationCode] = useState('');
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
  const bill = billFor(live.state, check);
  let estimate: number | undefined;
  let problem: string | undefined;
  let invoice: InvoiceRequest | undefined;
  try {
    estimate = paymentAmount(check, request, bill).amount;
  } catch (error) {
    problem = failureText(error, '金額有誤');
  }
  try {
    invoice = checkInvoice(
      invoiceType === 'DONATE'
        ? { carrierType: 'NONE', donationCode }
        : { carrierType: invoiceType, carrierId: invoiceType === 'NONE' ? null : carrierId, buyerTaxId },
    );
  } catch (error) {
    if (!problem) problem = failureText(error, '發票資料有誤');
  }

  const unpaidLines = bill.lines
    .filter((billed) => !check.paidLineKeys.includes(billed.key))
    .map(({ key, line, payable }) => ({ key, line, amount: payable }));

  const pay = () =>
    run(async () => {
      if (estimate === undefined || !invoice) return;
      const signature = JSON.stringify({ request, method, estimate, invoice, paid: check.paidTotal });
      if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      await actions.recordPayment({
        paymentId: pending.current.id,
        checkId,
        method,
        expectedAmount: estimate,
        invoice,
        ...request,
      });
      pending.current = undefined;
      notify(`已收${PAYMENT_LABEL[method]} ${formatMoney(estimate)}`);
      setSelected([]);
      setAmountText('');
      setInvoiceType('NONE');
      setCarrierId('');
      setBuyerTaxId('');
      setDonationCode('');
      if (kind === 'SHARE') setParts((current) => Math.max(1, current - 1));
    }, '收款失敗');

  return (
    <Modal
      title={`${check.tableName} 結帳`}
      onClose={onClose}
      footer={
        <>
          {problem && (kind !== 'BALANCE' || !invoice) && <p className="warning-note">{problem}</p>}
          <button
            className="button button-primary button-wide"
            disabled={busy || estimate === undefined || !invoice}
            onClick={pay}
          >
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
              <span className="field-hint">
                {KIND_LABEL[payment.kind]}・{describeInvoice(payment.invoice)}
              </span>
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

      <p className="field-label">發票</p>
      <div className="chip-row">
        {(['NONE', 'MOBILE', 'CERTIFICATE', 'DONATE'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={invoiceType === value}
            className={invoiceType === value ? 'chip is-selected' : 'chip'}
            onClick={() => setInvoiceType(value)}
          >
            {value === 'DONATE' ? '捐贈' : CARRIER_LABEL[value]}
          </button>
        ))}
      </div>
      {(invoiceType === 'MOBILE' || invoiceType === 'CERTIFICATE') && (
        <input
          className="text-input invoice-input"
          aria-label={CARRIER_LABEL[invoiceType]}
          placeholder={invoiceType === 'MOBILE' ? '手機條碼，例如 /ABC1234' : '自然人憑證號碼，例如 AB12345678901234'}
          value={carrierId}
          autoCapitalize="characters"
          onChange={(event) => setCarrierId(event.target.value)}
        />
      )}
      {invoiceType === 'DONATE' ? (
        <input
          className="text-input invoice-input"
          aria-label="愛心碼"
          placeholder="愛心碼，3 到 7 位數字"
          inputMode="numeric"
          value={donationCode}
          onChange={(event) => setDonationCode(event.target.value)}
        />
      ) : (
        <input
          className="text-input invoice-input"
          aria-label="統一編號"
          placeholder="統一編號（選填）"
          inputMode="numeric"
          maxLength={8}
          value={buyerTaxId}
          onChange={(event) => setBuyerTaxId(event.target.value)}
        />
      )}
      <p className="field-hint">
        這裡只記錄收款，不會實際刷卡。電子發票尚未串接，會先記下載具和統編，串接後再開立。付清後桌位會變成待清理。
      </p>
    </Modal>
  );
}

type ArrangeMode = 'MOVE' | 'ADD' | 'MERGE';

/**
 * Moves the party to an empty table, seats it at another as well, or brings
 * another table's bill onto this one.
 */
function ArrangeDialog({ check, mode, onClose }: { check: GuestCheck; mode: ArrangeMode; onClose(): void }) {
  const { catalog, live, actions, notify } = useApp();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const own = tablesOf(check);
  const [from, setFrom] = useState(own[0]);
  const nameOf = (tableId: string) => catalog.tables.find((table) => table.id === tableId)?.name ?? tableId;
  const empty = catalog.tables.filter((table) => tableState(live.state, table.id) === 'EMPTY');
  // Other parties still eating, one entry per bill.
  const others = [
    ...new Map(
      Object.values(live.state.checks)
        .filter((other) => other.status === 'OPEN' && other.id !== check.id && live.state.seatings[other.tableId]?.checkId === other.id)
        .map((other) => [other.id, other]),
    ).values(),
  ];

  const choose = (tableId: string) =>
    run(async () => {
      if (mode === 'MOVE') {
        await actions.moveTable(check.id, from, tableId);
        notify(`已從 ${nameOf(from)} 換到 ${nameOf(tableId)}`);
        onClose();
        void navigate({ to: '/pos/table/$tableId', params: { tableId } });
      } else {
        await actions.addTable(check.id, tableId);
        notify(`${nameOf(tableId)} 已併入 ${check.tableName}`);
        onClose();
      }
    }, mode === 'MOVE' ? '換桌失敗' : '併桌失敗');
  const merge = (other: GuestCheck) =>
    run(async () => {
      await actions.mergeChecks(other.id, check.id);
      notify(`${other.tableName} 的帳單已併入這桌`);
      onClose();
    }, '合併帳單失敗');

  const title = { MOVE: `${check.tableName} 換桌`, ADD: `${check.tableName} 加併桌位`, MERGE: `合併帳單到 ${check.tableName}` }[mode];
  return (
    <Modal title={title} onClose={onClose} footer={<button className="button button-wide" onClick={onClose}>取消</button>}>
      {mode === 'MOVE' && own.length > 1 && (
        <>
          <p className="field-label">要換掉哪一張</p>
          <div className="chip-row">
            {own.map((tableId) => (
              <button
                key={tableId}
                aria-pressed={from === tableId}
                className={from === tableId ? 'chip is-selected' : 'chip'}
                onClick={() => setFrom(tableId)}
              >
                {nameOf(tableId)}
              </button>
            ))}
          </div>
        </>
      )}
      {mode !== 'MERGE' ? (
        <>
          <p className="field-label">{mode === 'MOVE' ? '換到' : '再加這張桌'}</p>
          {empty.length === 0 ? (
            <p className="empty-note">目前沒有空桌</p>
          ) : (
            <div className="chip-row">
              {empty.map((table) => (
                <button key={table.id} className="chip" disabled={busy} onClick={() => choose(table.id)}>
                  {table.name}
                  <span className="field-hint">{table.zone ? `${table.zone}・` : ''}{table.seats} 人座</span>
                </button>
              ))}
            </div>
          )}
          <p className="field-hint">
            {mode === 'MOVE'
              ? '帳單和還沒上的菜會跟著換到新桌，廚房畫面也會更新桌名。'
              : '兩張桌共用這張帳單，適合人數多、要併桌的客人。'}
          </p>
        </>
      ) : (
        <>
          <p className="field-label">把哪一桌的帳單併進來</p>
          {others.length === 0 ? (
            <p className="empty-note">沒有其他用餐中的桌位</p>
          ) : (
            others.map((other) => (
              <div key={other.id} className="ready-row">
                <div>
                  <strong>{other.tableName}</strong> {formatMoney(other.billTotal)}
                  <div className="line-options">
                    {other.guestCount ? `${other.guestCount} 人・` : ''}
                    {other.paidTotal > 0 ? '已開始收款，不能合併' : `${other.rounds} 輪`}
                  </div>
                </div>
                <button
                  className="button button-small button-primary"
                  disabled={busy || other.paidTotal > 0}
                  onClick={() => merge(other)}
                >
                  併入
                </button>
              </div>
            ))
          )}
          <p className="field-hint">
            對方的點餐、取消和單品折扣都會併進這張帳單，兩桌一起結帳。服務費率以這桌為準。
          </p>
        </>
      )}
    </Modal>
  );
}

function VoidDialog({ ticket, line, onClose }: { ticket: KitchenTicket; line: TicketLine; onClose(): void }) {
  const { actions, notify, can } = useApp();
  const { busy, run } = useAction();
  const [reason, setReason] = useState<string>();
  const approver = can('approve');

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
