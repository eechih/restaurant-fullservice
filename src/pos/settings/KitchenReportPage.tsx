import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../appContext';
import type { Repository } from '../../data/repository';
import {
  businessDate,
  clockTime,
  isBusinessDate,
  kitchenReport,
  LATE_MINUTES,
  shiftDate,
  stationName,
  type Timing,
} from '../../domain';

const kitchenQuery = (repository: Pick<Repository, 'getDailyRecords'>, date: string) =>
  queryOptions({
    queryKey: ['daily-report', date],
    queryFn: () => repository.getDailyRecords(date),
    select: kitchenReport,
    placeholderData: keepPreviousData,
  });

const minutes = (value?: number) => (value === undefined ? '—' : `${value} 分`);

function TimingCells({ timing }: { timing: Timing }) {
  return (
    <>
      <td>{timing.tickets}</td>
      <td>{minutes(timing.waiting)}</td>
      <td>{minutes(timing.cooking)}</td>
      <td>{minutes(timing.passing)}</td>
      <td>{minutes(timing.total)}</td>
      <td>{timing.late || '—'}</td>
    </>
  );
}

const TIMING_HEADERS = ['工作單', '等待開始', '製作', '等待上菜', '送廚到上菜', `超過 ${LATE_MINUTES} 分`];

/** Where the kitchen waits: by station, by dish, and the slowest tickets of a day. */
export function KitchenReportPage() {
  const { catalog, reports } = useApp();
  const today = businessDate(Date.now());
  const [date, setDate] = useState(today);
  const { data: report, isPending, isError, refetch } = useQuery(kitchenQuery(reports, date));

  return (
    <section className="settings-panel daily-report" aria-label="出餐分析">
      <div className="settings-panel-header">
        <h2>出餐分析 {date}</h2>
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
        </div>
      </div>
      <p className="field-hint settings-hint">
        依當天付清的帳單計算，時間是平均分鐘。「等待開始」長代表廚房忙不過來；「製作」長代表這站或這道菜本身慢；「等待上菜」長代表在等其他站或服務員。
      </p>
      {isPending ? (
        <p className="empty-note">載入中…</p>
      ) : isError ? (
        <p className="empty-note">
          無法載入報表。<button className="link-button" onClick={() => void refetch()}>再試一次</button>
        </p>
      ) : report.stations.length === 0 ? (
        <p className="empty-note">這天沒有已完成的工作單</p>
      ) : (
        <>
          <table className="report-table">
            <caption>各出餐站，最慢的在前</caption>
            <thead>
              <tr>
                <th scope="col">出餐站</th>
                {TIMING_HEADERS.map((header) => (
                  <th key={header} scope="col">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.stations.map((row) => (
                <tr key={row.stationId ?? 'none'}>
                  <th scope="row">{stationName(catalog, row.stationId)}</th>
                  <TimingCells timing={row} />
                </tr>
              ))}
            </tbody>
          </table>
          {report.items.length > 0 && (
            <table className="report-table">
              <caption>最慢的菜色（至少出現在 2 張工作單）</caption>
              <thead>
                <tr>
                  <th scope="col">菜色</th>
                  {TIMING_HEADERS.map((header) => (
                    <th key={header} scope="col">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.items.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">{row.name}</th>
                    <TimingCells timing={row} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <table className="report-table">
            <caption>最慢的工作單（送廚到完成）</caption>
            <thead>
              <tr>
                <th scope="col" className="text-cell">送廚</th>
                <th scope="col" className="text-cell">桌位</th>
                <th scope="col" className="text-cell">出餐站</th>
                <th scope="col" className="text-cell">內容</th>
                <th scope="col">分鐘</th>
              </tr>
            </thead>
            <tbody>
              {report.slowest.map(({ ticket, minutes: taken }) => (
                <tr key={ticket.id}>
                  <td className="text-cell">{clockTime(ticket.sentAt)}</td>
                  <td className="text-cell">{ticket.tableName} 第 {ticket.round} 輪</td>
                  <td className="text-cell">{stationName(catalog, ticket.stationId)}</td>
                  <th scope="row">{ticket.lines.map((line) => `${line.name}×${line.quantity}`).join('、')}</th>
                  <td>{taken}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
