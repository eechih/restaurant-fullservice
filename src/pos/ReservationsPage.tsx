import { useState } from 'react';
import { useApp } from '../appContext';
import { businessDate, isBusinessDate, reservationsOn, shiftDate } from '../domain';
import { useNow } from '../ui/useNow';
import { AddWaitlistDialog, SeatDialog, WaitlistRow } from './FloorView';
import type { WaitlistEntry } from '../domain';

/** Bookings taken by phone, by day. On the day they also show on the floor's waitlist. */
export function ReservationsPage() {
  const { live } = useApp();
  const now = useNow();
  const today = businessDate(now);
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const [seating, setSeating] = useState<WaitlistEntry>();
  const bookings = reservationsOn(live.state, date);
  const guests = bookings.reduce((sum, entry) => sum + entry.partySize, 0);

  return (
    <section className="settings-panel reservations" aria-label="訂位">
      <div className="settings-panel-header">
        <h2>訂位 {date}</h2>
        <div className="report-tools">
          <button className="button button-small" disabled={date <= today} onClick={() => setDate(shiftDate(date, -1))}>
            前一天
          </button>
          <input
            className="text-input report-date"
            type="date"
            aria-label="日期"
            value={date}
            min={today}
            onChange={(event) => isBusinessDate(event.target.value) && setDate(event.target.value)}
          />
          <button className="button button-small" onClick={() => setDate(shiftDate(date, 1))}>後一天</button>
          <button className="button button-small button-primary" onClick={() => setAdding(true)}>新增訂位</button>
        </div>
      </div>
      <p className="field-hint settings-hint">
        訂位當天會和候位一起顯示在外場，客人到店後按「帶位」開桌。超過訂位時間還沒到，可以標記「未到」。
      </p>
      {bookings.length === 0 ? (
        <p className="empty-note">這天還沒有訂位</p>
      ) : (
        <>
          <p className="field-hint">共 {bookings.length} 組、{guests} 位</p>
          {bookings.map((entry) => (
            <WaitlistRow
              key={entry.id}
              entry={entry}
              now={now}
              onSeat={date === today ? () => setSeating(entry) : undefined}
            />
          ))}
        </>
      )}
      {adding && <AddWaitlistDialog date={date} onClose={() => setAdding(false)} />}
      {seating && <SeatDialog entry={seating} onClose={() => setSeating(undefined)} />}
    </section>
  );
}
