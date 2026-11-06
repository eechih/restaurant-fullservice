import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent, emptyLiveState, type LiveEvent, type LiveState } from '../domain';
import type { Repository } from './repository';

// A safety net for events missed without a visible disconnect.
const RESYNC_INTERVAL_MS = 60_000;

export interface LiveStatus {
  state: LiveState;
  online: boolean;
  loaded: boolean;
  syncError: boolean;
  dispatch(event: LiveEvent): void;
}

/**
 * Keeps a live copy of restaurant state: a full load, then incremental events.
 * Reloads whenever the connection returns, because events sent while the
 * connection was down are never redelivered.
 */
export function useLiveState(repository: Repository): LiveStatus {
  const [state, setState] = useState<LiveState>(emptyLiveState);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState(false);

  // Events that arrive during a load may be newer than the loaded data, so they
  // are held back and replayed on top of it.
  const pendingEvents = useRef<LiveEvent[]>([]);
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
        setState(replay.reduce(applyEvent, snapshot));
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
      setState((current) => replay.reduce(applyEvent, current));
    }
  }, [repository]);

  const dispatch = useCallback((event: LiveEvent) => {
    if (activeLoads.current > 0) pendingEvents.current.push(event);
    else setState((current) => applyEvent(current, event));
  }, []);

  useEffect(() => {
    let wasOnline = false;
    const unsubscribe = repository.subscribe({
      onEvent: dispatch,
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
