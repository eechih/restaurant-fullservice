import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { MANAGER_GROUP } from '../../src/domain';
import { orders } from '../functions/orders/resource';
import { staffAccounts } from '../functions/staff/resource';

const schema = a
  .schema({
    TicketStatus: a.enum(['NEW', 'PREPARING', 'READY', 'SERVED']),
    OrderStatus: a.enum(['PENDING', 'PAID', 'EXPIRED']),
    PaymentMethod: a.enum(['CASH', 'CARD']),
    StaffRole: a.enum(['MANAGER', 'STAFF']),

    OptionChoice: a.customType({
      id: a.id().required(),
      name: a.string().required(),
      priceDelta: a.integer().required(),
    }),
    OptionGroup: a.customType({
      id: a.id().required(),
      name: a.string().required(),
      required: a.boolean().required(),
      multiple: a.boolean().required(),
      choices: a.ref('OptionChoice').required().array().required(),
    }),
    SelectedOption: a.customType({
      groupName: a.string().required(),
      choiceName: a.string().required(),
      priceDelta: a.integer().required(),
    }),
    TicketLine: a.customType({
      id: a.id().required(),
      menuItemId: a.id().required(),
      name: a.string().required(),
      quantity: a.integer().required(),
      unitPrice: a.integer().required(),
      options: a.ref('SelectedOption').required().array().required(),
      note: a.string(),
    }),

    // Not readable by customers, because qrToken is what proves which table an
    // order is for.
    DiningTable: a
      .model({
        name: a.string().required(),
        seats: a.integer().required(),
        sortOrder: a.integer().required(),
        qrToken: a.string(),
      })
      .secondaryIndexes((index) => [index('qrToken').name('byQrToken')])
      .authorization((allow) => [allow.group(MANAGER_GROUP), allow.authenticated().to(['read'])]),
    MenuCategory: a
      .model({
        name: a.string().required(),
        sortOrder: a.integer().required(),
      })
      .authorization((allow) => [
        allow.guest().to(['read']),
        allow.authenticated('identityPool').to(['read']),
        allow.group(MANAGER_GROUP),
        allow.authenticated().to(['read']),
      ]),
    MenuItem: a
      .model({
        categoryId: a.id().required(),
        name: a.string().required(),
        price: a.integer().required(),
        sortOrder: a.integer().required(),
        optionGroups: a.ref('OptionGroup').required().array().required(),
        // Staff change this through setItemAvailable.
        available: a.boolean(),
      })
      .authorization((allow) => [
        allow.guest().to(['read']),
        allow.authenticated('identityPool').to(['read']),
        allow.group(MANAGER_GROUP),
        allow.authenticated().to(['read']),
      ]),

    // Keyed by table so that creating a second seating for an occupied table
    // fails on the server. This is what stops two staff opening the same table.
    Seating: a
      .model({
        tableId: a.id().required(),
        checkId: a.id().required(),
      })
      .identifier(['tableId']),

    // One party's stay at a table. Payment lives on each Order.
    GuestCheck: a.model({
      tableId: a.id().required(),
      tableName: a.string().required(),
      guestCount: a.integer(),
      openedAt: a.datetime().required(),
    }),

    // Written only by the orders function, which prices it on the server. Staff
    // can read it; customers see their own through getCustomerOrder.
    Order: a
      .model({
        tableId: a.id().required(),
        tableName: a.string().required(),
        checkId: a.id(),
        status: a.ref('OrderStatus').required(),
        lines: a.ref('TicketLine').required().array().required(),
        total: a.integer().required(),
        createdAt: a.datetime().required(),
        expiresAt: a.datetime().required(),
        paymentMethod: a.ref('PaymentMethod'),
        paidAt: a.datetime(),
        pickupNumber: a.integer(),
      })
      .secondaryIndexes((index) => [
        index('status').sortKeys(['createdAt']).queryField('ordersByStatus'),
      ])
      .authorization((allow) => [allow.authenticated().to(['read'])]),

    // Created only by the orders function, once the order is paid, so nothing
    // reaches the kitchen unpaid. Each order is a separate record, so concurrent
    // orders at one table cannot overwrite each other.
    KitchenTicket: a
      .model({
        checkId: a.id().required(),
        tableName: a.string().required(),
        round: a.integer().required(),
        status: a.ref('TicketStatus').required(),
        sentAt: a.datetime().required(),
        lines: a.ref('TicketLine').required().array().required(),
        pickupNumber: a.integer(),
      })
      .secondaryIndexes((index) => [
        index('status').sortKeys(['sentAt']).queryField('ticketsByStatus'),
        index('checkId').queryField('ticketsByCheck'),
      ])
      .authorization((allow) => [allow.authenticated().to(['read', 'update'])]),

    // A void is its own record rather than an edit to the ticket's lines, so
    // concurrent voids on one ticket cannot overwrite each other.
    // id is `${ticketId}#${lineId}`, which makes voiding a line idempotent.
    LineVoid: a
      .model({
        ticketId: a.id().required(),
        checkId: a.id().required(),
        lineId: a.id().required(),
        reason: a.string().required(),
        voidedAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [index('checkId').queryField('voidsByCheck')]),

    // The last takeout pickup number given on a business date, which is the id.
    // Only the orders function writes it, so numbers cannot repeat.
    PickupCounter: a
      .model({ value: a.integer().required() })
      .authorization((allow) => [allow.group(MANAGER_GROUP).to(['read'])]),

    OrderItemInput: a.customType({
      menuItemId: a.id().required(),
      quantity: a.integer().required(),
      choiceIds: a.id().required().array().required(),
      note: a.string(),
    }),
    // Only what a customer may see of their own order.
    CustomerOrder: a.customType({
      id: a.id().required(),
      tableId: a.id().required(),
      tableName: a.string().required(),
      status: a.ref('OrderStatus').required(),
      lines: a.ref('TicketLine').required().array().required(),
      total: a.integer().required(),
      createdAt: a.datetime().required(),
      expiresAt: a.datetime().required(),
      paidAt: a.datetime(),
      ticketStatus: a.ref('TicketStatus'),
      voidedLineIds: a.id().required().array().required(),
      pickupNumber: a.integer(),
    }),
    CustomerTable: a.customType({ name: a.string().required(), takeout: a.boolean().required() }),
    OrderRecord: a.customType({
      id: a.id().required(),
      tableId: a.id().required(),
      tableName: a.string().required(),
      checkId: a.id(),
      status: a.ref('OrderStatus').required(),
      lines: a.ref('TicketLine').required().array().required(),
      total: a.integer().required(),
      createdAt: a.datetime().required(),
      expiresAt: a.datetime().required(),
      paymentMethod: a.ref('PaymentMethod'),
      paidAt: a.datetime(),
      pickupNumber: a.integer(),
    }),
    TicketRecord: a.customType({
      id: a.id().required(),
      checkId: a.id().required(),
      tableName: a.string().required(),
      round: a.integer().required(),
      status: a.ref('TicketStatus').required(),
      sentAt: a.datetime().required(),
      lines: a.ref('TicketLine').required().array().required(),
      pickupNumber: a.integer(),
    }),
    CheckRecord: a.customType({
      id: a.id().required(),
      tableId: a.id().required(),
      tableName: a.string().required(),
      openedAt: a.datetime().required(),
    }),
    VoidRecord: a.customType({
      id: a.id().required(),
      ticketId: a.id().required(),
      checkId: a.id().required(),
      lineId: a.id().required(),
      reason: a.string().required(),
      voidedAt: a.datetime().required(),
    }),
    DailyRecords: a.customType({
      orders: a.ref('OrderRecord').required().array().required(),
      voids: a.ref('VoidRecord').required().array().required(),
    }),
    // Carries the records themselves, because the data API reads are eventually
    // consistent and could miss what the transaction just wrote. check is set only
    // when this payment opened the table.
    PaymentConfirmation: a.customType({
      order: a.ref('OrderRecord').required(),
      ticket: a.ref('TicketRecord').required(),
      check: a.ref('CheckRecord'),
    }),

    StaffMember: a.customType({
      username: a.string().required(),
      email: a.string().required(),
      role: a.ref('StaffRole').required(),
      enabled: a.boolean().required(),
      invited: a.boolean().required(),
      isSelf: a.boolean().required(),
    }),

    setItemAvailable: a
      .mutation()
      .arguments({ itemId: a.id().required(), available: a.boolean().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.custom({ dataSource: a.ref('MenuItem'), entry: './setItemAvailable.js' })),

    listStaff: a
      .query()
      .returns(a.ref('StaffMember').required().array().required())
      .authorization((allow) => [allow.group(MANAGER_GROUP)])
      .handler(a.handler.function(staffAccounts)),
    inviteStaff: a
      .mutation()
      .arguments({ email: a.string().required(), role: a.ref('StaffRole').required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.group(MANAGER_GROUP)])
      .handler(a.handler.function(staffAccounts)),
    resendStaffInvite: a
      .mutation()
      // Cognito resends by the email, not the generated username.
      .arguments({ email: a.string().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.group(MANAGER_GROUP)])
      .handler(a.handler.function(staffAccounts)),
    setStaffRole: a
      .mutation()
      .arguments({ username: a.string().required(), role: a.ref('StaffRole').required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.group(MANAGER_GROUP)])
      .handler(a.handler.function(staffAccounts)),
    setStaffEnabled: a
      .mutation()
      .arguments({ username: a.string().required(), enabled: a.boolean().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.group(MANAGER_GROUP)])
      .handler(a.handler.function(staffAccounts)),

    placeOrder: a
      .mutation()
      .arguments({
        orderId: a.id().required(),
        tableToken: a.string().required(),
        items: a.ref('OrderItemInput').required().array().required(),
        expectedTotal: a.integer().required(),
      })
      .returns(a.ref('CustomerOrder'))
      .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
      .handler(a.handler.function(orders)),
    placeStaffOrder: a
      .mutation()
      .arguments({
        orderId: a.id().required(),
        tableId: a.id().required(),
        items: a.ref('OrderItemInput').required().array().required(),
        expectedTotal: a.integer().required(),
      })
      .returns(a.ref('CustomerOrder'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(orders)),
    confirmOrderPayment: a
      .mutation()
      .arguments({
        orderId: a.id().required(),
        paymentMethod: a.ref('PaymentMethod').required(),
      })
      .returns(a.ref('PaymentConfirmation'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(orders)),
    getCustomerOrder: a
      .query()
      .arguments({ orderId: a.id().required() })
      .returns(a.ref('CustomerOrder'))
      .authorization((allow) => [
        allow.guest(),
        allow.authenticated('identityPool'),
        allow.authenticated(),
      ])
      .handler(a.handler.function(orders)),
    // The orders paid on a business date, for the manager's daily report.
    getDailyRecords: a
      .query()
      .arguments({ date: a.string().required() })
      .returns(a.ref('DailyRecords'))
      .authorization((allow) => [allow.group(MANAGER_GROUP)])
      .handler(a.handler.function(orders)),
    getCustomerTable: a
      .query()
      .arguments({ tableToken: a.string().required() })
      .returns(a.ref('CustomerTable'))
      .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
      .handler(a.handler.function(orders)),

    // The function writes to DynamoDB directly, which model subscriptions do not
    // see, so staff screens listen to these instead.
    onOrderPlaced: a
      .subscription()
      // Not placeStaffOrder: those are paid at once, so nobody is waiting on them.
      .for(a.ref('placeOrder'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.custom({ entry: './passThrough.js' })),
    onOrderPaid: a
      .subscription()
      .for(a.ref('confirmOrderPayment'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.custom({ entry: './passThrough.js' })),
  })
  .authorization((allow) => [allow.authenticated()]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
