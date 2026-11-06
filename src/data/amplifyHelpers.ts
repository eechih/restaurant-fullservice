import type { Schema } from '../../amplify/data/resource';
import {
  ConflictError,
  isRejection,
  RejectedError,
  STAFF_REJECTION_MESSAGE,
  StaffRejectedError,
  type MenuCategory,
  type MenuItem,
  type StaffRejection,
} from '../domain';

export interface ModelResult<T> {
  data: T;
  errors?: readonly { message: string; errorType?: string }[];
  nextToken?: string | null;
}

export function unwrap<T>({ data, errors }: ModelResult<T>): T {
  if (errors?.length) {
    // The functions report a rejection by using its code as the message.
    const rejected = errors.find((error) => isRejection(error.message));
    if (rejected) throw new RejectedError(rejected.message as RejectedError['code']);
    const refused = errors.find((error) => Object.hasOwn(STAFF_REJECTION_MESSAGE, error.message));
    if (refused) throw new StaffRejectedError(refused.message as StaffRejection);
    if (errors.some((error) => error.errorType === 'Unauthorized')) throw new RejectedError('FORBIDDEN');
    if (errors.some((error) => error.errorType?.includes('ConditionalCheckFailed'))) {
      throw new ConflictError(errors[0].message);
    }
    throw new Error(errors.map((error) => error.message).join('; '));
  }
  return data;
}

export async function listAll<T>(
  fetchPage: (nextToken?: string) => Promise<ModelResult<T[]>>,
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    items.push(...unwrap(page));
    nextToken = page.nextToken ?? undefined;
  } while (nextToken);
  return items;
}

const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;

export const toCategories = (raw: Schema['MenuCategory']['type'][]): MenuCategory[] =>
  raw.map(({ id, name, sortOrder, stationId }) => ({ id, name, sortOrder, stationId })).sort(bySortOrder);

export const toMenuItems = (raw: Schema['MenuItem']['type'][]): MenuItem[] =>
  raw
    .map(({ id, categoryId, name, price, sortOrder, optionGroups, available, stationId, noServiceCharge }) => ({
      id,
      categoryId,
      name,
      price,
      sortOrder,
      optionGroups,
      available,
      stationId,
      noServiceCharge,
    }))
    .sort(bySortOrder);
