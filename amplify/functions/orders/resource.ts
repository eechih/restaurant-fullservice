import { defineFunction } from '@aws-amplify/backend';

export const orders = defineFunction({
  name: 'orders',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // Lives with the data stack, which depends on it, to avoid a circular dependency.
  resourceGroupName: 'data',
});
