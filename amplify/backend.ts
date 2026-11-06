import { defineBackend } from '@aws-amplify/backend';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { orders } from './functions/orders/resource';
import { staffAccounts } from './functions/staff/resource';

const backend = defineBackend({ auth, data, orders, staffAccounts });

// Every signed-in user can run the restaurant, so accounts are created by a
// manager rather than through public sign-up. This sets only the one property,
// so the invitation email set in defineAuth is kept.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyOverride(
  'AdminCreateUserConfig.AllowAdminCreateUserOnly',
  true,
);

// Amplify gives each group its own IAM role, and maps the identity pool by token,
// so members get that role instead of the signed-in role, which has the customer
// pages' access. Managers need no extra AWS access, so the mapping is removed and
// everyone signed in gets the signed-in role. Without this a manager's device
// could not open a table's ordering page.
backend.auth.resources.cfnResources.cfnIdentityPoolRoleAttachment.addPropertyDeletionOverride('RoleMappings');

// The orders function writes Order, KitchenTicket, GuestCheck and Seating in one
// DynamoDB transaction, which the data API cannot do.
const { tables } = backend.data.resources;
const tableAccess = {
  DiningTable: ['dynamodb:GetItem', 'dynamodb:Query'],
  MenuItem: ['dynamodb:BatchGetItem'],
  Order: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
  KitchenTicket: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
  GuestCheck: ['dynamodb:PutItem'],
  LineVoid: ['dynamodb:BatchGetItem'],
  PickupCounter: ['dynamodb:UpdateItem'],
  Seating: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'],
};
const statements = Object.entries(tableAccess).map(([model, actions]) => {
  const table = tables[model];
  backend.orders.addEnvironment(`${model.toUpperCase()}_TABLE`, table.tableName);
  return new PolicyStatement({
    actions,
    resources: [table.tableArn, `${table.tableArn}/index/*`],
  });
});
backend.orders.resources.lambda.role?.attachInlinePolicy(
  new Policy(backend.orders.stack, 'OrdersTableAccess', { statements }),
);

// Granted here rather than through defineAuth's `access`, which puts the policy in
// the auth stack. The function is in the data stack, which already depends on
// auth, so that would be circular. Deleting users is deliberately left out.
const { userPool } = backend.auth.resources;
backend.staffAccounts.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.staffAccounts.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminUserGlobalSignOut',
    ],
    resources: [userPool.userPoolArn],
  }),
);
