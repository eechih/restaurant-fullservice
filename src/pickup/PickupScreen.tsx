import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../appContext';
import { openTakeoutTickets } from '../domain';
import { playChime, unlockChime } from '../ui/chime';

/**
 * For a screen facing customers: takeout numbers being made, and those ready to
 * collect. Runs on a signed-in staff device, so it needs no access of its own.
 */
export function PickupScreen() {
  const { live } = useApp();
  const open = openTakeoutTickets(live.state);
  const preparing = open.filter((ticket) => ticket.status !== 'READY');
  const ready = open.filter((ticket) => ticket.status === 'READY');
  const [unlocked, setUnlocked] = useState(false);
  // Numbers already ready when the screen opened stay silent.
  const announced = useRef<Set<string> | undefined>(undefined);

  useEffect(() => {
    const unlock = () => {
      void unlockChime().then((running) => {
        if (!running) return;
        setUnlocked(true);
        window.removeEventListener('pointerdown', unlock);
      });
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const readyIds = ready.map((ticket) => ticket.id).join(',');
  useEffect(() => {
    if (!live.loaded) return;
    const ids = readyIds ? readyIds.split(',') : [];
    if (!announced.current) {
      announced.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !announced.current!.has(id));
    fresh.forEach((id) => announced.current!.add(id));
    if (fresh.length > 0) playChime();
  }, [readyIds, live.loaded]);

  return (
    <div className="pickup-screen">
      <section className="pickup-column" aria-label="製作中">
        <h2>製作中</h2>
        <ul className="pickup-numbers">
          {preparing.map((ticket) => (
            <li key={ticket.id}>{ticket.pickupNumber}</li>
          ))}
        </ul>
      </section>
      <section className="pickup-column pickup-ready" aria-label="請取餐" aria-live="polite">
        <h2>請取餐</h2>
        <ul className="pickup-numbers">
          {ready.map((ticket) => (
            <li key={ticket.id}>{ticket.pickupNumber}</li>
          ))}
        </ul>
      </section>
      <footer className="pickup-footer">
        {!live.online && <span className="badge badge-danger" role="status">連線中斷，正在重連</span>}
        {!unlocked && <span className="badge badge-warn" role="status">點一下畫面以開啟叫號音效</span>}
        <Link to="/pos" className="link-button">離開</Link>
      </footer>
    </div>
  );
}
