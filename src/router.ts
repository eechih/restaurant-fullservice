import { QueryCache, QueryClient } from '@tanstack/react-query';
import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => console.error('Query failed', error) }),
  // Demo mode reads browser storage, so being offline must not pause its queries.
  defaultOptions: { queries: { networkMode: 'always' } },
});

// Hash URLs need no rewrite rules on static hosting.
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
