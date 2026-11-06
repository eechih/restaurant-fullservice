import { createContext, useCallback, useContext, useState } from 'react';
import type { LiveOperations, Repository, StaffDirectory } from './data/repository';
import type { LiveStatus } from './data/useLiveState';
import {
  REJECTION_MESSAGE,
  RejectedError,
  STAFF_REJECTION_MESSAGE,
  StaffRejectedError,
  type Catalog,
  type CatalogChange,
  type Permission,
  type Role,
  type TicketLine,
} from './domain';

export interface DraftLine extends TicketLine {
  choiceIds: string[];
}

/**
 * Lines not yet sent. The order id is kept so a retried send cannot duplicate,
 * and changes whenever the lines do, because a retry returns the order as first sent.
 */
export interface Draft {
  orderId: string;
  lines: DraftLine[];
}

/** The live operations, applied to this screen as soon as they succeed. */
export type LiveActions = {
  [K in keyof LiveOperations]: (...args: Parameters<LiveOperations[K]>) => Promise<void>;
};

export interface Actions extends LiveActions {
  seedCatalog(): Promise<void>;
  changeCatalog(changes: CatalogChange[]): Promise<void>;
  setItemAvailable(itemId: string, available: boolean): Promise<void>;
  rotateTableToken(tableId: string): Promise<void>;
}

export interface AppContextValue {
  /** Shows or hides screens and buttons. The server enforces them separately. */
  roles: Role[];
  can(permission: Permission): boolean;
  /** Missing in demo mode. */
  staff?: StaffDirectory;
  /** Reads for reports, which are fetched per page rather than kept live. */
  reports: Pick<Repository, 'getDailyRecords'>;
  catalog: Catalog;
  catalogState: 'loading' | 'ready' | 'failed';
  live: LiveStatus;
  actions: Actions;
  /** Keyed by check. */
  drafts: Record<string, Draft>;
  setDraft(checkId: string, draft: Draft | undefined): void;
  notify(message: string, isError?: boolean): void;
}

export const emptyCatalog: Catalog = { tables: [], categories: [], items: [], stations: [] };

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext');
  return value;
}

export function failureText(error: unknown, failureMessage: string) {
  if (error instanceof RejectedError) return REJECTION_MESSAGE[error.code];
  if (error instanceof StaffRejectedError) return STAFF_REJECTION_MESSAGE[error.code];
  return `${failureMessage}，請再試一次`;
}

/**
 * Runs a write, reports failure to the user, and blocks repeat taps meanwhile.
 * Resolves to whether it succeeded.
 */
export function useAction() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: () => Promise<void>, failureMessage: string): Promise<boolean> => {
      setBusy(true);
      try {
        await action();
        return true;
      } catch (error) {
        console.error(failureMessage, error);
        notify(failureText(error, failureMessage), true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  return { busy, run };
}
