import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { catalogQuery } from './data/catalogQuery';
import type { Repository } from './data/repository';
import { useLiveState } from './data/useLiveState';
import { emptyCatalog, type Actions, AppContext, type AppContextValue, type Draft } from './appContext';
import { ArrivalAlert } from './ArrivalAlert';
import { can as roleCan, RejectedError, ROLE_LABEL, type LiveChange, type Permission, type Role } from './domain';

interface AppProps {
  repository: Repository;
  roles: Role[];
  userLabel?: string;
  onSignOut?: () => void;
  /** Demo mode's stand-in for signing in as someone else. */
  roleSwitcher?: ReactNode;
}

export type View = 'floor' | 'expo' | 'kds' | 'availability' | 'qr' | 'settings';

interface NavItem {
  view: View;
  to: '/pos' | '/expo' | '/kds' | '/pos/availability' | '/pos/qr' | '/pos/settings';
  label: string;
  matches(pathname: string): boolean;
  allowed(can: (permission: Permission) => boolean): boolean;
}

const NAV: NavItem[] = [
  {
    view: 'floor',
    to: '/pos',
    label: '外場',
    matches: (pathname) => pathname === '/pos' || pathname === '/pos/' || pathname.startsWith('/pos/table'),
    allowed: (can) => can('openTable') || can('waitlist') || can('checkout'),
  },
  {
    view: 'kds',
    to: '/kds',
    label: 'KDS 廚房',
    matches: (pathname) => pathname.startsWith('/kds'),
    allowed: (can) => can('cook'),
  },
  {
    view: 'expo',
    to: '/expo',
    label: '出菜口',
    matches: (pathname) => pathname.startsWith('/expo'),
    allowed: (can) => can('serve'),
  },
  {
    view: 'availability',
    to: '/pos/availability',
    label: '售完管理',
    matches: (pathname) => pathname.startsWith('/pos/availability'),
    allowed: (can) => can('availability'),
  },
  {
    view: 'qr',
    to: '/pos/qr',
    label: 'QR Code',
    matches: (pathname) => pathname.startsWith('/pos/qr'),
    allowed: (can) => can('settings'),
  },
  {
    view: 'settings',
    to: '/pos/settings',
    label: '店務設定',
    matches: (pathname) => pathname.startsWith('/pos/settings'),
    allowed: (can) => can('settings') || can('report'),
  },
];

export function App({ repository, roles, userLabel, onSignOut, roleSwitcher }: AppProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
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
  const can = useCallback((permission: Permission) => roleCan(roles, permission), [roles]);

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

  // Each write is also applied here at once: the notification that reaches every
  // screen can lag, and this screen should not show a stale table meanwhile.
  const actions = useMemo<Actions>(() => {
    const apply =
      <A extends unknown[]>(operation: (...args: A) => Promise<LiveChange>) =>
      async (...args: A) => {
        dispatch(await operation(...args));
      };
    // The repositories never use `this`, so their methods can be passed on.
    const r = repository;
    return {
      openTable: apply(r.openTable),
      cancelTable: apply(r.cancelTable),
      confirmCustomerOrder: apply(r.confirmCustomerOrder),
      rejectCustomerOrder: apply(r.rejectCustomerOrder),
      setTicketStatus: apply(r.setTicketStatus),
      serveTickets: apply(r.serveTickets),
      requestVoid: apply(r.requestVoid),
      decideVoid: apply(r.decideVoid),
      requestBill: apply(r.requestBill),
      recordPayment: apply(r.recordPayment),
      closeCheck: apply(r.closeCheck),
      markTableCleaned: apply(r.markTableCleaned),
      addToWaitlist: apply(r.addToWaitlist),
      cancelWaitlistEntry: apply(r.cancelWaitlistEntry),
      async sendOrder(input) {
        try {
          dispatch(await repository.sendOrder(input));
        } catch (error) {
          // A rejected order usually means this device has an outdated menu.
          if (error instanceof RejectedError) void reloadCatalog();
          throw error;
        }
      },
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
    };
  }, [repository, reloadCatalog, dispatch]);

  const context = useMemo(
    () => ({
      roles,
      can,
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
    [roles, can, repository, catalog, catalogState, live, actions, drafts, setDraft, notify],
  );

  const allowed = NAV.filter((item) => item.allowed(can));
  const current = NAV.find((item) => item.matches(pathname));
  const isDark = current?.view === 'kds' || current?.view === 'expo';

  let page: ReactNode = <Outlet />;
  if (allowed.length === 0) {
    page = <p className="empty-note">這個帳號還沒有設定角色，請洽店長。</p>;
  } else if (current && !current.allowed(can)) {
    // For example, a kitchen account lands on the kitchen screen.
    page = <Navigate to={allowed[0].to} replace />;
  }

  return (
    <AppContext.Provider value={context}>
      <div className={isDark ? 'app theme-kds' : 'app'}>
        <header className="topbar">
          <nav className="topbar-nav" aria-label="主要頁面">
            {allowed.map((item) => (
              <Link key={item.view} to={item.to} className={item === current ? 'is-active' : ''}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-status">
            {current && <ArrivalAlert view={current.view} />}
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
            {roleSwitcher}
            <span className={live.online && !live.syncError ? 'badge badge-ok' : 'badge badge-danger'} role="status">
              {!live.online ? '連線中斷，正在重連' : live.syncError ? '同步失敗，將自動重試' : '已連線'}
            </span>
            {userLabel && (
              <span className="topbar-user">
                {userLabel}
                {roles.length > 0 && `（${roles.map((role) => ROLE_LABEL[role]).join('、')}）`}
              </span>
            )}
            {onSignOut && (
              <button className="link-button" onClick={onSignOut}>
                登出
              </button>
            )}
          </div>
        </header>
        <main className="page">{page}</main>
        {toast && (
          <div key={toast.id} className={toast.isError ? 'toast toast-error' : 'toast'} role="alert">
            {toast.message}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
