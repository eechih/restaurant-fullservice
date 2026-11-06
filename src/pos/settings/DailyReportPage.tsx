import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../appContext';
import type { Repository } from '../../data/repository';
import {
  businessDate,
  dailyReport,
  formatMoney,
  isBusinessDate,
  shiftDate,
  type PaymentMethod,
} from '../../domain';

const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: '現金', CARD: '刷卡' };

const dailyQuery = (repository: Pick<Repository, 'getDailyRecords'>, date: string, isToday: boolean) =>
  queryOptions({
    queryKey: ['daily-report', date],
    queryFn: () => repository.getDailyRecords(date),
    select: ({ orders, voids }) => dailyReport(orders, voids),
    // Today keeps changing while the restaurant is open; past days do not.
    refetchInterval: isToday ? 60_000 : false,
    staleTime: isToday ? 0 : 5 * 60_000,
    placeholderData: keepPreviousData,
  });

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });

export function DailyReportPage() {
  const { reports } = useApp();
  const today = businessDate(Date.now());
  const [date, setDate] = useState(today);
  const { data: report, isPending, isError, isFetching, refetch } = useQuery(
    dailyQuery(reports, date, date === today),
  );

  return (
    <section className="settings-panel daily-report" aria-label="日結報表">
      <div className="settings-panel-header">
        <h2>日結報表 {date}</h2>
        <div className="report-tools no-print">
          <button className="button button-small" onClick={() => setDate(shiftDate(date, -1))}>前一天</button>
          <input
            className="text-input report-date"
            type="date"
            aria-label="營業日"
            value={date}
            max={today}
            onChange={(event) => isBusinessDate(event.target.value) && setDate(event.target.value)}
          />
          <button className="button button-small" disabled={date >= today} onClick={() => setDate(shiftDate(date, 1))}>
            後一天
          </button>
          <button className="button button-small" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? '更新中…' : '重新整理'}
          </button>
          <button className="button button-small" onClick={() => window.print()}>列印</button>
        </div>
      </div>
      <p className="field-hint settings-hint">
        以台灣時間 0:00 到 24:00 計算，金額以付款時間歸日。取消品項的退款算在原訂單付款的那天，依原付款方式退回。
        {date === today && ' 今天的報表每分鐘自動更新。'}
      </p>

      {isPending ? (
        <p className="empty-note">載入中…</p>
      ) : isError ? (
        <p className="empty-note">
          無法載入報表。<button className="link-button" onClick={() => void refetch()}>再試一次</button>
        </p>
      ) : report.orders === 0 ? (
        <p className="empty-note">這天沒有已付款的訂單</p>
      ) : (
        <>
          <table className="report-table report-summary">
            <caption>收款與退款</caption>
            <thead>
              <tr>
                <th scope="col">付款方式</th>
                <th scope="col">筆數</th>
                <th scope="col">收款</th>
                <th scope="col">退款</th>
                <th scope="col">實收</th>
              </tr>
            </thead>
            <tbody>
              {(['CASH', 'CARD'] as const).map((method) => {
                const row = report.byPayment[method];
                return (
                  <tr key={method}>
                    <th scope="row">{PAYMENT_LABEL[method]}</th>
                    <td>{row.orders}</td>
                    <td>{formatMoney(row.received)}</td>
                    <td>{row.refunded > 0 ? `−${formatMoney(row.refunded)}` : '—'}</td>
                    <td>{formatMoney(row.received - row.refunded)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">合計</th>
                <td>{report.orders}</td>
                <td>{formatMoney(report.received)}</td>
                <td>{report.refunded > 0 ? `−${formatMoney(report.refunded)}` : '—'}</td>
                <td>{formatMoney(report.received - report.refunded)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="field-hint report-note">
            {report.takeout.orders > 0 &&
              `其中外帶 ${report.takeout.orders} 筆，收款 ${formatMoney(report.takeout.received)}。`}
            現金實收 {formatMoney(report.byPayment.CASH.received - report.byPayment.CASH.refunded)}{' '}
            應等於收銀機現金減去開店時的零用金。
          </p>

          <table className="report-table">
            <caption>品項銷售</caption>
            <thead>
              <tr>
                <th scope="col">品項</th>
                <th scope="col">份數</th>
                <th scope="col">金額</th>
                <th scope="col">取消份數</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item) => (
                <tr key={`${item.menuItemId}-${item.name}`}>
                  <th scope="row">{item.name}</th>
                  <td>{item.quantity}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>{item.voidedQuantity || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field-hint report-note">金額含客製選項加價，不含已取消的品項。</p>

          {report.refunds.length > 0 && (
            <table className="report-table">
              <caption>取消與退款明細</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-cell">時間</th>
                  <th scope="col" className="text-cell">桌位</th>
                  <th scope="col" className="text-cell">品項</th>
                  <th scope="col">退款</th>
                  <th scope="col" className="text-cell">方式</th>
                  <th scope="col" className="text-cell">原因</th>
                </tr>
              </thead>
              <tbody>
                {report.refunds.map((refund, index) => (
                  <tr key={index}>
                    <td className="text-cell">{timeOf(refund.voidedAt)}</td>
                    <td className="text-cell">{refund.tableName}</td>
                    <th scope="row">{refund.name} × {refund.quantity}</th>
                    <td>{formatMoney(refund.amount)}</td>
                    <td className="text-cell">{PAYMENT_LABEL[refund.paymentMethod]}</td>
                    <td className="text-cell">{refund.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
