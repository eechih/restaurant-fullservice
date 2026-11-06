import { useRouter } from '@tanstack/react-router';
import { useApp } from '../appContext';
import {
  billFor,
  businessDate,
  clockTime,
  describeDiscount,
  describeInvoice,
  formatMoney,
  isLineDiscount,
  PAYMENT_LABEL,
  paymentsForCheck,
} from '../domain';

/**
 * A receipt for a check, sized for an 80 mm receipt printer. It is not an
 * e-invoice: those are issued once a provider is connected.
 */
export function ReceiptPage({ checkId }: { checkId: string }) {
  const { catalog, live, can } = useApp();
  const router = useRouter();
  const check = live.state.checks[checkId];
  const back = (
    <button className="button no-print" onClick={() => router.history.back()}>
      返回
    </button>
  );
  if (!can('checkout')) return <p className="empty-note">你的角色不能列印收據。</p>;
  if (!check) {
    return (
      <div className="seed-prompt">
        <h1>{live.loaded ? '找不到這張帳單' : '載入中…'}</h1>
        {live.loaded && <p>清桌後重新整理頁面，就無法再列印這張帳單的收據。</p>}
        {back}
      </div>
    );
  }
  const { settings } = catalog;
  const bill = billFor(live.state, check);
  const payments = paymentsForCheck(live.state, check.id);
  const checkDiscount = check.discounts.find(
    (discount) => discount.status === 'APPROVED' && !isLineDiscount(discount.kind),
  );

  return (
    <div className="receipt-page">
      <div className="receipt-tools no-print">
        {back}
        <button className="button button-primary" onClick={() => window.print()}>
          列印
        </button>
      </div>
      <article className="receipt" aria-label="收據">
        <header className="receipt-header">
          <h1>{settings.storeName || '收據'}</h1>
          {settings.taxId && <p>統一編號 {settings.taxId}</p>}
          {settings.address && <p>{settings.address}</p>}
          {settings.phone && <p>電話 {settings.phone}</p>}
        </header>
        <p className="receipt-meta">
          <span>{check.tableName}{check.guestCount ? `・${check.guestCount} 位` : ''}</span>
          <span>
            {businessDate(check.closedAt ?? check.openedAt)} {clockTime(check.openedAt)}
            {check.closedAt && `–${clockTime(check.closedAt)}`}
          </span>
        </p>
        <table className="receipt-lines">
          <tbody>
            {bill.lines.map(({ key, line, amount, net, discount }) => (
              <tr key={key}>
                <td>
                  {line.name} × {line.quantity}
                  {line.options.length > 0 && <div className="receipt-option">{line.options.map((option) => option.choiceName).join('、')}</div>}
                  {discount && net !== amount && <div className="receipt-option">{describeDiscount(discount)} −{formatMoney(amount - net)}</div>}
                </td>
                <td>{formatMoney(net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="receipt-totals">
          <tbody>
            <tr>
              <th scope="row">小計</th>
              <td>{formatMoney(bill.itemsTotal - bill.lineDiscounts)}</td>
            </tr>
            {checkDiscount && bill.checkDiscount > 0 && (
              <tr>
                <th scope="row">{describeDiscount(checkDiscount)}</th>
                <td>−{formatMoney(bill.checkDiscount)}</td>
              </tr>
            )}
            {check.serviceChargeRate > 0 && (
              <tr>
                <th scope="row">服務費 {check.serviceChargeRate}%</th>
                <td>{formatMoney(bill.serviceCharge)}</td>
              </tr>
            )}
            <tr className="receipt-total">
              <th scope="row">合計</th>
              <td>{formatMoney(bill.total)}</td>
            </tr>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <th scope="row">
                  {PAYMENT_LABEL[payment.method]}
                  <div className="receipt-option">
                    {describeInvoice(payment.invoice)}・{payment.invoiceNumber ? `發票 ${payment.invoiceNumber}` : '發票待開立'}
                  </div>
                </th>
                <td>{formatMoney(payment.amount)}</td>
              </tr>
            ))}
            {check.status === 'OPEN' && (
              <tr>
                <th scope="row">未付</th>
                <td>{formatMoney(bill.total - check.paidTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <footer className="receipt-footer">本收據不是統一發票。謝謝光臨。</footer>
      </article>
    </div>
  );
}
