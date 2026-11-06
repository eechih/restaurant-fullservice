import { useCallback, useEffect, useRef, useState } from 'react';
import { applyChange, emptyLiveState, type LiveChange, type LiveState } from '../domain';
import type { Repository } from './repository';

// A safety net for events missed without a visible disconnect.
const RESYNC_INTERVAL_MS = 60_000;

export interface LiveStatus {
  state: LiveState;
  online: boolean;
  loaded: boolean;
  syncError: boolean;
  dispatch(change: LiveChange): void;
}

/**
 * Keeps a live copy of restaurant state: a full load, then incremental changes.
 * Reloads whenever the connection returns, because changes sent while the
 * connection was down are never redelivered.
 */
export function useLiveState(repository: Repository): LiveStatus {
  const [state, setState] = useState<LiveState>(emptyLiveState);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState(false);

  // Changes that arrive during a load may be newer than the loaded data, so they
  // are held back and replayed on top of it.
  const pendingEvents = useRef<LiveChange[]>([]);
  const activeLoads = useRef(0);
  const latestLoad = useRef(0);

  const reload = useCallback(async () => {
    const loadId = ++latestLoad.current;
    activeLoads.current += 1;
    try {
      const snapshot = await repository.loadLiveState();
      activeLoads.current -= 1;
      if (loadId === latestLoad.current) {
        const replay = pendingEvents.current;
        pendingEvents.current = [];
        setState(replay.reduce(applyChange, snapshot));
        setLoaded(true);
        setSyncError(false);
      }
    } catch (error) {
      console.error('Failed to load live state', error);
      activeLoads.current -= 1;
      if (loadId === latestLoad.current) setSyncError(true);
    }
    if (activeLoads.current === 0 && pendingEvents.current.length > 0) {
      const replay = pendingEvents.current;
      pendingEvents.current = [];
      setState((current) => replay.reduce(applyChange, current));
    }
  }, [repository]);

  const dispatch = useCallback((change: LiveChange) => {
    if (activeLoads.current > 0) pendingEvents.current.push(change);
    else setState((current) => applyChange(current, change));
  }, []);

  useEffect(() => {
    let wasOnline = false;
    const unsubscribe = repository.subscribe({
      onChange: dispatch,
      onConnection(isOnline) {
        setOnline(isOnline);
        if (isOnline && !wasOnline) void reload();
        wasOnline = isOnline;
      },
    });
    void reload();
    const timer = setInterval(() => void reload(), RESYNC_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [repository, reload, dispatch]);

  return { state, online, loaded, syncError, dispatch };
}
