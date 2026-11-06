import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { CustomerOrder, CustomerRepository } from './customerRepository';
import { listAll, toCategories, toMenuItems, unwrap } from './amplifyHelpers';

function toCustomerOrder(raw: NonNullable<Schema['CustomerOrder']['type']>): CustomerOrder {
  return {
    id: raw.id,
    tableId: raw.tableId,
    tableName: raw.tableName,
    status: raw.status,
    lines: raw.lines,
    total: raw.total,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    kitchenStatus: raw.kitchenStatus,
    voidedLineIds: raw.voidedLineIds,
  };
}

/** Call after Amplify.configure(). Customers use the guest identity, with no sign-in. */
export function createAmplifyCustomerRepository(): CustomerRepository {
  const { models, mutations, queries } = generateClient<Schema>({ authMode: 'identityPool' });

  return {
    async getTable(tableToken) {
      const table = unwrap(await queries.getCustomerTable({ tableToken }));
      return table ? { name: table.name } : null;
    },
    async getMenu() {
      const [categories, items, settings] = await Promise.all([
        listAll((nextToken) => models.MenuCategory.list({ nextToken })),
        listAll((nextToken) => models.MenuItem.list({ nextToken })),
        models.StoreSettings.get({ id: 'store' }).then(unwrap),
      ]);
      return {
        categories: toCategories(categories),
        items: toMenuItems(items),
        serviceChargeRate: settings?.serviceChargeRate ?? 0,
      };
    },
    async placeOrder(input) {
      const order = unwrap(await mutations.placeOrder(input));
      if (!order) throw new Error('failed to place order');
      return toCustomerOrder(order);
    },
    async getOrder(orderId) {
      const order = unwrap(await queries.getCustomerOrder({ orderId }));
      return order ? toCustomerOrder(order) : null;
    },
  };
}
