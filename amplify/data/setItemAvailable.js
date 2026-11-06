import { util } from '@aws-appsync/utils';

// Staff may mark items sold out, but only managers may edit the menu, so this
// writes the one field instead of going through the model's update.
export function request(ctx) {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.itemId }),
    update: {
      expression: 'SET #available = :available, #updatedAt = :now',
      expressionNames: { '#available': 'available', '#updatedAt': 'updatedAt' },
      expressionValues: util.dynamodb.toMapValues({
        ':available': ctx.args.available,
        ':now': util.time.nowISO8601(),
      }),
    },
    condition: { expression: 'attribute_exists(id)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return true;
}
