import { queryOptions } from '@tanstack/react-query';
import type { CustomerRepository } from '../data/customerRepository';

const POLL_INTERVAL_MS = 5_000;
const SERVED_POLL_INTERVAL_MS = 30_000;

export const tableQuery = (repository: CustomerRepository, tableToken: string) =>
  queryOptions({
    queryKey: ['customer', 'table', tableToken],
    queryFn: () => repository.getTable(tableToken),
    staleTime: 5 * 60_000,
  });

export const menuQuery = (repository: CustomerRepository) =>
  queryOptions({
    queryKey: ['customer', 'menu'],
    queryFn: () => repository.getMenu(),
    staleTime: 60_000,
    // Picks up sold out changes while someone is browsing.
    refetchInterval: 60_000,
  });

export const orderQuery = (repository: CustomerRepository, orderId: string) =>
  queryOptions({
    queryKey: ['customer', 'order', orderId],
    queryFn: () => repository.getOrder(orderId),
    refetchInterval: ({ state: { data } }) => {
      if (data === null || data?.status === 'EXPIRED' || data?.status === 'REJECTED') return false;
      // A served order only changes if staff cancel a line afterwards.
      return data?.kitchenStatus === 'SERVED' ? SERVED_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    },
  });
