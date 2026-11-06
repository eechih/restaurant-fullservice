import { useEffect, useRef, useState } from 'react';
import type { View } from './App';
import { useApp } from './appContext';
import {
  billRequests,
  isFullyVoided,
  pendingOrders,
  readyRounds,
  ticketsAtStation,
  voidRequests,
  type LiveState,
  type Permission,
} from './domain';
import { loadStation } from './kds/station';
import { playChime, unlockChime } from './ui/chime';

const STORAGE_KEY = 'arrival-sound-enabled';

function loadEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** What each screen chimes for, keyed so that different things never share an id. */
function waiting(state: LiveState, view: View, can: (permission: Permission) => boolean) {
  switch (view) {
    case 'kds': {
      const station = loadStation();
      return {
        key: `kds:${station}`,
        ids: ticketsAtStation(state, station, ['NEW'])
          .filter((ticket) => !isFullyVoided(state, ticket))
          .map((ticket) => ticket.id),
      };
    }
    case 'expo':
      return { key: 'expo', ids: readyRounds(state).map((round) => round.orderId) };
    case 'floor':
      return {
        key: 'floor',
        ids: [
          ...(can('order') ? pendingOrders(state, Date.now()).map((order) => `order:${order.id}`) : []),
          ...(can('approveVoid') ? voidRequests(state).map((lineVoid) => `void:${lineVoid.id}`) : []),
          ...(can('serve') ? readyRounds(state).map((round) => `ready:${round.orderId}`) : []),
          ...(can('checkout') ? billRequests(state).map((check) => `bill:${check.id}`) : []),
        ],
      };
    default:
      return { key: view, ids: [] };
  }
}

/** Sounds a chime when something new needs someone, so nobody has to watch the screen. */
export function ArrivalAlert({ view }: { view: View }) {
  const { live, can } = useApp();
  const [enabled, setEnabled] = useState(loadEnabled);
  const [unlocked, setUnlocked] = useState(false);
  // Everything seen in this view, so that sending a ticket back does not sound
  // again, and what was already waiting at load or on switching view stays silent.
  const seen = useRef<{ key: string; ids: Set<string> } | undefined>(undefined);

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
    const { key, ids } = waiting(live.state, view, can);
    if (seen.current?.key !== key) {
      seen.current = { key, ids: new Set(ids) };
      return;
    }
    const known = seen.current.ids;
    const arrived = ids.filter((id) => !known.has(id));
    arrived.forEach((id) => known.add(id));
    if (arrived.length > 0 && enabled) playChime();
  }, [live.state, live.loaded, view, can, enabled]);

  if (view !== 'floor' && view !== 'expo' && view !== 'kds') return null;

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
      {enabled && !unlocked && <span className="badge badge-warn" role="status">點一下畫面以開啟提示音</span>}
      <button className="link-button" aria-pressed={enabled} onClick={toggle}>
        提示音：{enabled ? '開' : '關'}
      </button>
    </>
  );
}
