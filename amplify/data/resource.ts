import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { ROLES, rolesFor } from '../../src/domain';
import { orders } from '../functions/orders/resource';
import { staffAccounts } from '../functions/staff/resource';

const live = a.handler.function(orders);

// Operations are allowed by role with rolesFor, which the app's screens use too.
const schema = a
  .schema({
    TicketStatus: a.enum(['NEW', 'PREPARING', 'READY', 'SERVED']),
    OrderStatus: a.enum(['PENDING', 'SENT', 'REJECTED', 'EXPIRED']),
    OrderSource: a.enum(['STAFF', 'CUSTOMER']),
    CheckStatus: a.enum(['OPEN', 'CLOSED', 'CANCELLED']),
    VoidStatus: a.enum(['REQUESTED', 'APPROVED', 'REJECTED']),
    PaymentMethod: a.enum(['CASH', 'CARD']),
    PaymentKind: a.enum(['BALANCE', 'AMOUNT', 'SHARE', 'LINES']),
    WaitlistStatus: a.enum(['WAITING', 'SEATED', 'CANCELLED']),
    Role: a.enum([...ROLES]),

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
      stationId: a.id(),
    }),

    // The catalog. Only managers edit it.

    // Not readable by customers, because qrToken is what proves which table an
    // order is for.
    DiningTable: a
      .model({
        name: a.string().required(),
        seats: a.integer().required(),
        sortOrder: a.integer().required(),
        zone: a.string(),
        qrToken: a.string(),
      })
      .secondaryIndexes((index) => [index('qrToken').name('byQrToken')])
      .authorization((allow) => [allow.group('MANAGER'), allow.authenticated().to(['read'])]),
    Station: a
      .model({
        name: a.string().required(),
        sortOrder: a.integer().required(),
      })
      .authorization((allow) => [allow.group('MANAGER'), allow.authenticated().to(['read'])]),
    MenuCategory: a
      .model({
        name: a.string().required(),
        sortOrder: a.integer().required(),
        stationId: a.id(),
      })
      .authorization((allow) => [
        allow.guest().to(['read']),
        allow.authenticated('identityPool').to(['read']),
        allow.group('MANAGER'),
        allow.authenticated().to(['read']),
      ]),
    MenuItem: a
      .model({
        categoryId: a.id().required(),
        name: a.string().required(),
        price: a.integer().required(),
        sortOrder: a.integer().required(),
        optionGroups: a.ref('OptionGroup').required().array().required(),
        // Changed through setItemAvailable.
        available: a.boolean(),
        stationId: a.id(),
      })
      .authorization((allow) => [
        allow.guest().to(['read']),
        allow.authenticated('identityPool').to(['read']),
        allow.group('MANAGER'),
        allow.authenticated().to(['read']),
      ]),

    // Live records. Staff read them; only the orders function writes them, so
    // that every rule about the bill is checked in one place.

    // Keyed by table, so that opening an occupied table fails on the server.
    Seating: a
      .model({
        tableId: a.id().required(),
        checkId: a.id().required(),
      })
      .identifier(['tableId'])
      .authorization((allow) => [allow.authenticated().to(['read'])]),
    GuestCheck: a
      .model({
        tableId: a.id().required(),
        tableName: a.string().required(),
        guestCount: a.integer(),
        partyName: a.string(),
        status: a.ref('CheckStatus').required(),
        openedAt: a.datetime().required(),
        rounds: a.integer().required(),
        billTotal: a.integer().required(),
        paidTotal: a.integer().required(),
        paidLineKeys: a.string().required().array().required(),
        billRequestedAt: a.datetime(),
        closedAt: a.datetime(),
        closedDate: a.string(),
      })
      .secondaryIndexes((index) => [index('closedDate').name('byClosedDate').queryField('checksByClosedDate')])
      .authorization((allow) => [allow.authenticated().to(['read'])]),
    // Customers see their own through getCustomerOrder.
    Order: a
      .model({
        source: a.ref('OrderSource').required(),
        tableId: a.id().required(),
        tableName: a.string().required(),
        checkId: a.id(),
        status: a.ref('OrderStatus').required(),
        lines: a.ref('TicketLine').required().array().required(),
        total: a.integer().required(),
        createdAt: a.datetime().required(),
        expiresAt: a.datetime().required(),
        round: a.integer(),
        ticketIds: a.id().required().array().required(),
        decidedAt: a.datetime(),
      })
      .secondaryIndexes((index) => [
        index('status').sortKeys(['createdAt']).name('byStatus').queryField('ordersByStatus'),
      ])
      .authorization((allow) => [allow.authenticated().to(['read'])]),
    KitchenTicket: a
      .model({
        orderId: a.id().required(),
        checkId: a.id().required(),
        tableName: a.string().required(),
        round: a.integer().required(),
        stationId: a.id(),
        status: a.ref('TicketStatus').required(),
        sentAt: a.datetime().required(),
        lines: a.ref('TicketLine').required().array().required(),
      })
      .secondaryIndexes((index) => [
        index('status').sortKeys(['sentAt']).name('byStatus').queryField('ticketsByStatus'),
        index('checkId').name('byCheck').queryField('ticketsByCheck'),
      ])
      .authorization((allow) => [allow.authenticated().to(['read'])]),
    // id is `${ticketId}#${lineId}`, so a line has at most one.
    LineVoid: a
      .model({
        ticketId: a.id().required(),
        checkId: a.id().required(),
        lineId: a.id().required(),
        reason: a.string().required(),
        status: a.ref('VoidStatus').required(),
        requestedBy: a.string().required(),
        requestedAt: a.datetime().required(),
        decidedBy: a.string(),
        decidedAt: a.datetime(),
      })
      .secondaryIndexes((index) => [index('checkId').name('byCheck').queryField('voidsByCheck')])
      .authorization((allow) => [allow.authenticated().to(['read'])]),
    Payment: a
      .model({
        checkId: a.id().required(),
        tableName: a.string().required(),
        method: a.ref('PaymentMethod').required(),
        kind: a.ref('PaymentKind').required(),
        amount: a.integer().required(),
        parts: a.integer(),
        lineKeys: a.string().required().array().required(),
        paidAt: a.datetime().required(),
        businessDate: a.string().required(),
      })
      .secondaryIndexes((index) => [
        index('checkId').name('byCheck').queryField('paymentsByCheck'),
        index('businessDate').name('byBusinessDate').queryField('paymentsByDate'),
      ])
      .authorization((allow) => [allow.authenticated().to(['read'])]),
    WaitlistEntry: a
      .model({
        name: a.string().required(),
        partySize: a.integer().required(),
        phone: a.string(),
        status: a.ref('WaitlistStatus').required(),
        createdAt: a.datetime().required(),
        seatedAt: a.datetime(),
        tableId: a.id(),
      })
      .secondaryIndexes((index) => [
        index('status').sortKeys(['createdAt']).name('byStatus').queryField('waitlistByStatus'),
      ])
      .authorization((allow) => [allow.authenticated().to(['read'])]),

    // What the orders function returns. The data API's reads are eventually
    // consistent, so a write returns the records it wrote.

    SeatingRecord: a.customType({ tableId: a.id().required(), checkId: a.id().required() }),
    CheckRecord: a.customType({
      id: a.id().required(),
      tableId: a.id().required(),
      tableName: a.string().required(),
      guestCount: a.integer(),
      partyName: a.string(),
      status: a.ref('CheckStatus').required(),
      openedAt: a.datetime().required(),
      rounds: a.integer().required(),
      billTotal: a.integer().required(),
      paidTotal: a.integer().required(),
      paidLineKeys: a.string().required().array().required(),
      billRequestedAt: a.datetime(),
      closedAt: a.datetime(),
      closedDate: a.string(),
      updatedAt: a.datetime().required(),
    }),
    OrderRecord: a.customType({
      id: a.id().required(),
      source: a.ref('OrderSource').required(),
      tableId: a.id().required(),
      tableName: a.string().required(),
      checkId: a.id(),
      status: a.ref('OrderStatus').required(),
      lines: a.ref('TicketLine').required().array().required(),
      total: a.integer().required(),
      createdAt: a.datetime().required(),
      expiresAt: a.datetime().required(),
      round: a.integer(),
      ticketIds: a.id().required().array().required(),
      decidedAt: a.datetime(),
      updatedAt: a.datetime().required(),
    }),
    TicketRecord: a.customType({
      id: a.id().required(),
      orderId: a.id().required(),
      checkId: a.id().required(),
      tableName: a.string().required(),
      round: a.integer().required(),
      stationId: a.id(),
      status: a.ref('TicketStatus').required(),
      sentAt: a.datetime().required(),
      lines: a.ref('TicketLine').required().array().required(),
      updatedAt: a.datetime().required(),
    }),
    VoidRecord: a.customType({
      id: a.id().required(),
      ticketId: a.id().required(),
      checkId: a.id().required(),
      lineId: a.id().required(),
      reason: a.string().required(),
      status: a.ref('VoidStatus').required(),
      requestedBy: a.string().required(),
      requestedAt: a.datetime().required(),
      decidedBy: a.string(),
      decidedAt: a.datetime(),
      updatedAt: a.datetime().required(),
    }),
    PaymentRecord: a.customType({
      id: a.id().required(),
      checkId: a.id().required(),
      tableName: a.string().required(),
      method: a.ref('PaymentMethod').required(),
      kind: a.ref('PaymentKind').required(),
      amount: a.integer().required(),
      parts: a.integer(),
      lineKeys: a.string().required().array().required(),
      paidAt: a.datetime().required(),
      businessDate: a.string().required(),
    }),
    WaitlistRecord: a.customType({
      id: a.id().required(),
      name: a.string().required(),
      partySize: a.integer().required(),
      phone: a.string(),
      status: a.ref('WaitlistStatus').required(),
      createdAt: a.datetime().required(),
      seatedAt: a.datetime(),
      tableId: a.id(),
      updatedAt: a.datetime().required(),
    }),
    LiveChange: a.customType({
      seatings: a.ref('SeatingRecord').required().array().required(),
      clearedSeatings: a.ref('SeatingRecord').required().array().required(),
      checks: a.ref('CheckRecord').required().array().required(),
      tickets: a.ref('TicketRecord').required().array().required(),
      voids: a.ref('VoidRecord').required().array().required(),
      orders: a.ref('OrderRecord').required().array().required(),
      payments: a.ref('PaymentRecord').required().array().required(),
      waitlist: a.ref('WaitlistRecord').required().array().required(),
    }),
    DailyRecords: a.customType({
      payments: a.ref('PaymentRecord').required().array().required(),
      checks: a.ref('CheckRecord').required().array().required(),
      tickets: a.ref('TicketRecord').required().array().required(),
      voids: a.ref('VoidRecord').required().array().required(),
    }),

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
      kitchenStatus: a.ref('TicketStatus'),
      voidedLineIds: a.id().required().array().required(),
    }),
    CustomerTable: a.customType({ name: a.string().required() }),

    StaffMember: a.customType({
      username: a.string().required(),
      email: a.string().required(),
      roles: a.ref('Role').required().array().required(),
      enabled: a.boolean().required(),
      invited: a.boolean().required(),
      isSelf: a.boolean().required(),
    }),

    setItemAvailable: a
      .mutation()
      .arguments({ itemId: a.id().required(), available: a.boolean().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.groups(rolesFor('availability'))])
      .handler(a.handler.custom({ dataSource: a.ref('MenuItem'), entry: './setItemAvailable.js' })),

    listStaff: a
      .query()
      .returns(a.ref('StaffMember').required().array().required())
      .authorization((allow) => [allow.groups(rolesFor('settings'))])
      .handler(a.handler.function(staffAccounts)),
    inviteStaff: a
      .mutation()
      .arguments({ email: a.string().required(), roles: a.ref('Role').required().array().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.groups(rolesFor('settings'))])
      .handler(a.handler.function(staffAccounts)),
    resendStaffInvite: a
      .mutation()
      // Cognito resends by the email, not the generated username.
      .arguments({ email: a.string().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.groups(rolesFor('settings'))])
      .handler(a.handler.function(staffAccounts)),
    setStaffRoles: a
      .mutation()
      .arguments({ username: a.string().required(), roles: a.ref('Role').required().array().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.groups(rolesFor('settings'))])
      .handler(a.handler.function(staffAccounts)),
    setStaffEnabled: a
      .mutation()
      .arguments({ username: a.string().required(), enabled: a.boolean().required() })
      .returns(a.boolean())
      .authorization((allow) => [allow.groups(rolesFor('settings'))])
      .handler(a.handler.function(staffAccounts)),

    // Customers. They are not signed in.

    getCustomerTable: a
      .query()
      .arguments({ tableToken: a.string().required() })
      .returns(a.ref('CustomerTable'))
      .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
      .handler(live),
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
      .handler(live),
    getCustomerOrder: a
      .query()
      .arguments({ orderId: a.id().required() })
      .returns(a.ref('CustomerOrder'))
      .authorization((allow) => [allow.guest(), allow.authenticated('identityPool'), allow.authenticated()])
      .handler(live),

    // Staff. Each returns what it changed, which onLiveChange passes on.

    openTable: a
      .mutation()
      .arguments({
        checkId: a.id().required(),
        tableId: a.id().required(),
        guestCount: a.integer().required(),
        waitlistEntryId: a.id(),
      })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('openTable'))])
      .handler(live),
    cancelTable: a
      .mutation()
      .arguments({ checkId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('openTable'))])
      .handler(live),
    sendOrder: a
      .mutation()
      .arguments({
        orderId: a.id().required(),
        checkId: a.id().required(),
        items: a.ref('OrderItemInput').required().array().required(),
        expectedTotal: a.integer().required(),
      })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('order'))])
      .handler(live),
    confirmCustomerOrder: a
      .mutation()
      .arguments({ orderId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('order'))])
      .handler(live),
    rejectCustomerOrder: a
      .mutation()
      .arguments({ orderId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('order'))])
      .handler(live),
    setTicketStatus: a
      .mutation()
      .arguments({ ticketId: a.id().required(), status: a.ref('TicketStatus').required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('cook'))])
      .handler(live),
    serveTickets: a
      .mutation()
      .arguments({ ticketIds: a.id().required().array().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('serve'))])
      .handler(live),
    // Approvers' own requests are approved at once.
    requestVoid: a
      .mutation()
      .arguments({ ticketId: a.id().required(), lineId: a.id().required(), reason: a.string().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('order'))])
      .handler(live),
    decideVoid: a
      .mutation()
      .arguments({ voidId: a.id().required(), approve: a.boolean().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('approveVoid'))])
      .handler(live),
    requestBill: a
      .mutation()
      .arguments({ checkId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('order'))])
      .handler(live),
    recordPayment: a
      .mutation()
      .arguments({
        paymentId: a.id().required(),
        checkId: a.id().required(),
        method: a.ref('PaymentMethod').required(),
        kind: a.ref('PaymentKind').required(),
        amount: a.integer(),
        parts: a.integer(),
        lineKeys: a.string().required().array(),
        expectedAmount: a.integer().required(),
      })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('checkout'))])
      .handler(live),
    closeCheck: a
      .mutation()
      .arguments({ checkId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('checkout'))])
      .handler(live),
    markTableCleaned: a
      .mutation()
      .arguments({ tableId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('clearTable'))])
      .handler(live),
    addToWaitlist: a
      .mutation()
      .arguments({
        entryId: a.id().required(),
        name: a.string().required(),
        partySize: a.integer().required(),
        phone: a.string(),
      })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('waitlist'))])
      .handler(live),
    cancelWaitlistEntry: a
      .mutation()
      .arguments({ entryId: a.id().required() })
      .returns(a.ref('LiveChange'))
      .authorization((allow) => [allow.groups(rolesFor('waitlist'))])
      .handler(live),
    getDailyRecords: a
      .query()
      .arguments({ date: a.string().required() })
      .returns(a.ref('DailyRecords'))
      .authorization((allow) => [allow.groups(rolesFor('report'))])
      .handler(live),

    // The function writes to DynamoDB directly, which model subscriptions do not
    // see, so staff screens listen to these instead.
    onLiveChange: a
      .subscription()
      .for([
        a.ref('openTable'),
        a.ref('cancelTable'),
        a.ref('sendOrder'),
        a.ref('confirmCustomerOrder'),
        a.ref('rejectCustomerOrder'),
        a.ref('setTicketStatus'),
        a.ref('serveTickets'),
        a.ref('requestVoid'),
        a.ref('decideVoid'),
        a.ref('requestBill'),
        a.ref('recordPayment'),
        a.ref('closeCheck'),
        a.ref('markTableCleaned'),
        a.ref('addToWaitlist'),
        a.ref('cancelWaitlistEntry'),
      ])
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.custom({ entry: './passThrough.js' })),
    onOrderPlaced: a
      .subscription()
      .for(a.ref('placeOrder'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.custom({ entry: './passThrough.js' })),
  })
  .authorization((allow) => [allow.authenticated()]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
