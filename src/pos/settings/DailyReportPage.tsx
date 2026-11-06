import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../appContext';
import type { Repository } from '../../data/repository';
import {
  businessDate,
  clockTime,
  dailyReport,
  formatMoney,
  isBusinessDate,
  PAYMENT_LABEL,
  shiftDate,
} from '../../domain';

const dailyQuery = (repository: Pick<Repository, 'getDailyRecords'>, date: string, isToday: boolean) =>
  queryOptions({
    queryKey: ['daily-report', date],
    queryFn: () => repository.getDailyRecords(date),
    select: dailyReport,
    // Today keeps changing while the restaurant is open; past days do not.
    refetchInterval: isToday ? 60_000 : false,
    staleTime: isToday ? 0 : 5 * 60_000,
    placeholderData: keepPreviousData,
  });

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
        以台灣時間 0:00 到 24:00 計算。收款以收款時間歸日；桌數、人數和品項以帳單付清的時間歸日，跨過午夜的帳單不會拆成兩天。
        {date === today && ' 今天的報表每分鐘自動更新。'}
      </p>

      {isPending ? (
        <p className="empty-note">載入中…</p>
      ) : isError ? (
        <p className="empty-note">
          無法載入報表。<button className="link-button" onClick={() => void refetch()}>再試一次</button>
        </p>
      ) : report.checks === 0 && report.received === 0 ? (
        <p className="empty-note">這天沒有收款，也沒有付清的帳單</p>
      ) : (
        <>
          <table className="report-table report-summary">
            <caption>收款</caption>
            <thead>
              <tr>
                <th scope="col">收款方式</th>
                <th scope="col">筆數</th>
                <th scope="col">金額</th>
              </tr>
            </thead>
            <tbody>
              {(['CASH', 'CARD'] as const).map((method) => (
                <tr key={method}>
                  <th scope="row">{PAYMENT_LABEL[method]}</th>
                  <td>{report.byMethod[method].count}</td>
                  <td>{formatMoney(report.byMethod[method].amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">合計</th>
                <td>{report.byMethod.CASH.count + report.byMethod.CARD.count}</td>
                <td>{formatMoney(report.received)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="field-hint report-note">
            付清 {report.checks} 桌、{report.guests} 位客人，帳單合計 {formatMoney(report.billed)}
            {report.checks > 0 && `，平均每桌 ${formatMoney(Math.round(report.billed / report.checks))}`}。
            現金 {formatMoney(report.byMethod.CASH.amount)} 應等於收銀機現金減去開店時的零用金。
          </p>

          {report.items.length > 0 && (
            <>
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
            </>
          )}

          {report.voids.length > 0 && (
            <table className="report-table">
              <caption>取消明細</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-cell">時間</th>
                  <th scope="col" className="text-cell">桌位</th>
                  <th scope="col" className="text-cell">品項</th>
                  <th scope="col">金額</th>
                  <th scope="col" className="text-cell">原因</th>
                  <th scope="col" className="text-cell">申請／核准</th>
                </tr>
              </thead>
              <tbody>
                {report.voids.map((line, index) => (
                  <tr key={index}>
                    <td className="text-cell">{clockTime(line.decidedAt)}</td>
                    <td className="text-cell">{line.tableName}</td>
                    <th scope="row">{line.name} × {line.quantity}</th>
                    <td>{formatMoney(line.amount)}</td>
                    <td className="text-cell">{line.reason}</td>
                    <td className="text-cell">
                      {line.requestedBy === line.decidedBy ? line.decidedBy : `${line.requestedBy}／${line.decidedBy}`}
                    </td>
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
