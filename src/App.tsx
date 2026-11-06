import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { catalogQuery } from './data/catalogQuery';
import type { Repository } from './data/repository';
import { useLiveState } from './data/useLiveState';
import { emptyCatalog, type Actions, AppContext, type AppContextValue, type Draft } from './appContext';
import { ArrivalAlert } from './ArrivalAlert';
import { OrderRejectedError, type LiveEvent, type StaffRole } from './domain';

interface AppProps {
  repository: Repository;
  role: StaffRole;
  userLabel?: string;
  onSignOut?: () => void;
}

export function App({ repository, role, userLabel, onSignOut }: AppProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isKds = pathname.startsWith('/kds');
  const isQr = pathname.startsWith('/pos/qr');
  const isAvailability = pathname.startsWith('/pos/availability');
  const isSettings = pathname.startsWith('/pos/settings');
  const isTakeout = pathname.startsWith('/pos/takeout');
  // Faces customers, so it shows no staff navigation.
  const isPickup = pathname.startsWith('/pickup');
  const queryClient = useQueryClient();
  const live = useLiveState(repository);
  const { dispatch } = live;
  const { data, isPending } = useQuery(catalogQuery(repository));
  const reloadCatalog = useCallback(
    () => queryClient.invalidateQueries({ queryKey: catalogQuery(repository).queryKey }),
    [queryClient, repository],
  );
  const catalog = data ?? emptyCatalog;
  // A failed background refresh keeps showing the menu it already has.
  const catalogState: AppContextValue['catalogState'] = data ? 'ready' : isPending ? 'loading' : 'failed';
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<{ id: number; message: string; isError: boolean }>();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string, isError = false) => {
    setToast({ id: Date.now(), message, isError });
  }, []);

  const setDraft = useCallback((checkId: string, draft: Draft | undefined) => {
    setDrafts((current) => {
      const next = { ...current };
      if (draft) next[checkId] = draft;
      else delete next[checkId];
      return next;
    });
  }, []);

  // Each write is also applied locally: subscription events can lag, and the
  // screen should not show a table as empty straight after it has been opened.
  const actions = useMemo<Actions>(() => {
    const applyPayment = (events: LiveEvent[]) => {
      events.forEach(dispatch);
      for (const event of events) {
        if (event.type === 'order/upsert') return event.order.pickupNumber ?? undefined;
      }
      return undefined;
    };
    return {
      async seedCatalog() {
        await repository.seedCatalog();
        await reloadCatalog();
      },
      async changeCatalog(changes) {
        try {
          await repository.changeCatalog(changes);
        } finally {
          // Part of a failed change may have been saved.
          await reloadCatalog();
        }
      },
      async setItemAvailable(itemId, available) {
        await repository.setItemAvailable(itemId, available);
        await reloadCatalog();
      },
      async rotateTableToken(tableId) {
        await repository.rotateTableToken(tableId);
        await reloadCatalog();
      },
      async openTable(input) {
        const check = await repository.openTable(input);
        dispatch({ type: 'check/upsert', check });
        dispatch({ type: 'seating/upsert', seating: { tableId: input.tableId, checkId: check.id } });
        return check;
      },
      async placeAndPay(order, paymentMethod) {
        try {
          await repository.placeStaffOrder(order);
        } catch (error) {
          // A rejected order usually means this device has an outdated menu.
          if (error instanceof OrderRejectedError) void reloadCatalog();
          throw error;
        }
        return applyPayment(await repository.confirmOrderPayment(order.orderId, paymentMethod));
      },
      async confirmOrderPayment(order, paymentMethod) {
        return applyPayment(await repository.confirmOrderPayment(order.id, paymentMethod));
      },
      async setTicketStatus(ticket, status) {
        await repository.setTicketStatus(ticket.id, status);
        dispatch({ type: 'ticket/upsert', ticket: { ...ticket, status } });
      },
      async voidLine(lineVoid) {
        await repository.voidLine(lineVoid);
        dispatch({ type: 'void/upsert', lineVoid });
      },
      async clearTable(tableId) {
        await repository.clearTable(tableId);
        dispatch({ type: 'seating/delete', tableId });
      },
    };
  }, [repository, reloadCatalog, dispatch]);

  const context = useMemo(
    () => ({
      role,
      staff: repository.staff,
      reports: repository,
      catalog,
      catalogState,
      live,
      actions,
      drafts,
      setDraft,
      notify,
    }),
    [role, repository, catalog, catalogState, live, actions, drafts, setDraft, notify],
  );

  return (
    <AppContext.Provider value={context}>
      <div className={isKds ? 'app theme-kds' : 'app'}>
        {!isPickup && (
          <header className="topbar">
            <nav className="topbar-nav" aria-label="主要頁面">
              <Link to="/pos" className={isKds || isQr || isAvailability || isSettings || isTakeout ? '' : 'is-active'}>
                POS
              </Link>
              <Link to="/pos/takeout" className={isTakeout ? 'is-active' : ''}>外帶</Link>
              <Link to="/kds" className={isKds ? 'is-active' : ''}>KDS 廚房</Link>
              <Link to="/pos/availability" className={isAvailability ? 'is-active' : ''}>售完管理</Link>
              <Link to="/pos/qr" className={isQr ? 'is-active' : ''}>QR Code</Link>
              {role === 'MANAGER' && (
                <Link to="/pos/settings" className={isSettings ? 'is-active' : ''}>店務設定</Link>
              )}
            </nav>
            <div className="topbar-status">
              <ArrivalAlert isKds={isKds} />
              {repository.mode === 'demo' && (
                <>
                  <span className="badge badge-warn">本機展示模式</span>
                  <button
                    className="link-button"
                    onClick={() => {
                      repository.resetDemo?.();
                      window.location.hash = '#/pos';
                      window.location.reload();
                    }}
                  >
                    重置資料
                  </button>
                </>
              )}
              <span className={live.online && !live.syncError ? 'badge badge-ok' : 'badge badge-danger'} role="status">
                {!live.online ? '連線中斷，正在重連' : live.syncError ? '同步失敗，將自動重試' : '已連線'}
              </span>
              {userLabel && (
                <span className="topbar-user">
                  {userLabel}
                  {role === 'MANAGER' && '（店長）'}
                </span>
              )}
              {onSignOut && <button className="link-button" onClick={onSignOut}>登出</button>}
            </div>
          </header>
        )}
        <main className={isPickup ? 'page page-bare' : 'page'}><Outlet /></main>
        {toast && (
          <div key={toast.id} className={toast.isError ? 'toast toast-error' : 'toast'} role="alert">
            {toast.message}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
