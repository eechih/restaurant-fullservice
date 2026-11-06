import { defineFunction } from '@aws-amplify/backend';

export const staffAccounts = defineFunction({
  name: 'staff-accounts',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // Lives with the data stack, which depends on it, to avoid a circular dependency.
  resourceGroupName: 'data',
});
