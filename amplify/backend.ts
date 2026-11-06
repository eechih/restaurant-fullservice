import { defineBackend } from '@aws-amplify/backend';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data, ORDERS_DATA_SOURCE, STAFF_DATA_SOURCE } from './data/resource';
import { orders } from './functions/orders/resource';
import { staffAccounts } from './functions/staff/resource';

const backend = defineBackend({ auth, data, orders, staffAccounts });

// The operations reach the functions through these, by name. One data source,
// and so one IAM role, per function.
backend.data.addLambdaDataSource(ORDERS_DATA_SOURCE, backend.orders.resources.lambda);
backend.data.addLambdaDataSource(STAFF_DATA_SOURCE, backend.staffAccounts.resources.lambda);

// Signed-in users run the restaurant, so accounts are created by a manager
// rather than through public sign-up. This sets only the one property, so the
// invitation email set in defineAuth is kept.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyOverride(
  'AdminCreateUserConfig.AllowAdminCreateUserOnly',
  true,
);

// Amplify gives each group its own IAM role, and maps the identity pool by token,
// so members get that role instead of the signed-in role, which has the customer
// pages' access. Staff need no extra AWS access, so the mapping is removed and
// everyone signed in gets the signed-in role. Without this a staff device could
// not open a table's ordering page.
backend.auth.resources.cfnResources.cfnIdentityPoolRoleAttachment.addPropertyDeletionOverride('RoleMappings');

// The orders function writes the live records in DynamoDB transactions, which
// the data API cannot do. The catalog is only read.
const { tables } = backend.data.resources;
const read = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'];
const write = [...read, 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'];
const tableAccess: Record<string, string[]> = {
  DiningTable: read,
  MenuItem: read,
  MenuCategory: read,
  Station: read,
  StoreSettings: read,
  Seating: write,
  GuestCheck: write,
  Order: write,
  KitchenTicket: write,
  LineVoid: write,
  Payment: write,
  WaitlistEntry: write,
};
const statements = Object.entries(tableAccess).map(([model, actions]) => {
  const table = tables[model];
  backend.orders.addEnvironment(`${model.toUpperCase()}_TABLE`, table.tableName);
  return new PolicyStatement({
    actions,
    resources: [table.tableArn, `${table.tableArn}/index/*`],
  });
});

// Granted here rather than through defineAuth's `access`, which puts the policy in
// the auth stack. The functions are in the data stack, which already depends on
// auth, so that would be circular.
const { userPool } = backend.auth.resources;

// Cancellations record who asked and who approved, by their sign-in email.
backend.orders.addEnvironment('USER_POOL_ID', userPool.userPoolId);
statements.push(new PolicyStatement({ actions: ['cognito-idp:AdminGetUser'], resources: [userPool.userPoolArn] }));
backend.orders.resources.lambda.role?.attachInlinePolicy(
  new Policy(backend.orders.stack, 'OrdersTableAccess', { statements }),
);

// Deleting users is deliberately left out.
backend.staffAccounts.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.staffAccounts.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminUserGlobalSignOut',
    ],
    resources: [userPool.userPoolArn],
  }),
);
