import { util } from '@aws-appsync/utils';

// Calls a function through a data source shared by every operation it serves.
// Amplify's function handler gives each operation its own data source and IAM
// role, and the AWS account this runs in is short of roles.
export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: { fieldName: ctx.info.fieldName, arguments: ctx.arguments, identity: ctx.identity },
  };
}

export function response(ctx) {
  // The functions report a rejection by using its code as the message.
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
