import { useEffect, useRef, useState } from 'react';
import { useApp } from './appContext';
import { isFullyVoided, pendingOrders, ticketsWithStatus, type LiveState } from './domain';
import { playChime, unlockChime } from './ui/chime';

const STORAGE_KEY = 'arrival-sound-enabled';

function loadEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** POS watches for orders waiting for payment, and KDS for tickets waiting to be cooked. */
const waitingIds = (state: LiveState, isKds: boolean) =>
  isKds
    ? ticketsWithStatus(state, ['NEW'])
        .filter((ticket) => !isFullyVoided(state, ticket))
        .map((ticket) => ticket.id)
    : pendingOrders(state, Date.now()).map((order) => order.id);

/** Sounds a chime when something new arrives, so nobody has to watch the screen. */
export function ArrivalAlert({ isKds }: { isKds: boolean }) {
  const { live } = useApp();
  const [enabled, setEnabled] = useState(loadEnabled);
  const [unlocked, setUnlocked] = useState(false);
  // Everything seen in this view, so that sending a ticket back does not sound
  // again, and what was already waiting at load or on switching view stays silent.
  const seen = useRef<{ isKds: boolean; ids: Set<string> } | undefined>(undefined);

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

  useEffect(() => {
    if (!live.loaded) return;
    const ids = waitingIds(live.state, isKds);
    if (seen.current?.isKds !== isKds) {
      seen.current = { isKds, ids: new Set(ids) };
      return;
    }
    const known = seen.current.ids;
    const arrived = ids.filter((id) => !known.has(id));
    arrived.forEach((id) => known.add(id));
    if (arrived.length > 0 && enabled) playChime();
  }, [live.state, live.loaded, isKds, enabled]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The setting then lasts until the page is reloaded.
    }
  };

  return (
    <>
      {enabled && !unlocked && (
        <span className="badge badge-warn" role="status">點一下畫面以開啟提示音</span>
      )}
      <button className="link-button" aria-pressed={enabled} onClick={toggle}>
        提示音：{enabled ? '開' : '關'}
      </button>
    </>
  );
}
