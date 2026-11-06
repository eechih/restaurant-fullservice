import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  MANAGER_GROUP,
  StaffRejectedError,
  type StaffMember,
  type StaffRejection,
  type StaffRole,
} from '../../../src/domain';

const cognito = new CognitoIdentityProviderClient();
const UserPoolId = process.env.USER_POOL_ID;

/** Cognito's errors that mean the request, not the system, was at fault. */
const COGNITO_REJECTIONS: Record<string, StaffRejection> = {
  UsernameExistsException: 'STAFF_EXISTS',
  UserNotFoundException: 'STAFF_NOT_FOUND',
  UnsupportedUserStateException: 'ALREADY_SIGNED_IN',
  // Cognito's own sender allows only a few emails a day.
  LimitExceededException: 'EMAIL_FAILED',
  CodeDeliveryFailureException: 'EMAIL_FAILED',
};

/** Turns Cognito's rejections into ones staff can act on. */
const call = <T>(request: Promise<T>) =>
  request.catch((error: Error) => {
    const code = COGNITO_REJECTIONS[error.name];
    throw code ? new StaffRejectedError(code) : error;
  });

async function listStaff(self: string): Promise<StaffMember[]> {
  const users: UserType[] = [];
  let PaginationToken: string | undefined;
  do {
    const page = await call(cognito.send(new ListUsersCommand({ UserPoolId, PaginationToken })));
    users.push(...(page.Users ?? []));
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);

  const managers = new Set<string>();
  let NextToken: string | undefined;
  do {
    const page = await call(
      cognito.send(new ListUsersInGroupCommand({ UserPoolId, GroupName: MANAGER_GROUP, NextToken })),
    );
    page.Users?.forEach((user) => user.Username && managers.add(user.Username));
    NextToken = page.NextToken;
  } while (NextToken);

  return users
    .flatMap((user): StaffMember[] =>
      user.Username
        ? [
            {
              username: user.Username,
              email: user.Attributes?.find((attribute) => attribute.Name === 'email')?.Value ?? '',
              role: managers.has(user.Username) ? 'MANAGER' : 'STAFF',
              enabled: user.Enabled ?? true,
              invited: user.UserStatus === 'FORCE_CHANGE_PASSWORD',
              isSelf: user.Username === self,
            },
          ]
        : [],
    )
    .sort((a, b) => a.email.localeCompare(b.email));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function inviteStaff(email: string, role: StaffRole) {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 254) throw new StaffRejectedError('INVALID_EMAIL');
  const { User } = await call(
    cognito.send(
      new AdminCreateUserCommand({
        UserPoolId,
        // Sign-in is by email, so Cognito keeps this as an alias and generates the username.
        Username: address,
        UserAttributes: [
          { Name: 'email', Value: address },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    ),
  ).catch((error: Error) => {
    // Cognito checks the address more strictly than the pattern above.
    if (error.name === 'InvalidParameterException') throw new StaffRejectedError('INVALID_EMAIL');
    throw error;
  });
  if (role === 'MANAGER' && User?.Username) await setRole(User.Username, role);
  return true;
}

async function setRole(username: string, role: StaffRole) {
  const input = { UserPoolId, Username: username, GroupName: MANAGER_GROUP };
  if (role === 'MANAGER') {
    await call(cognito.send(new AdminAddUserToGroupCommand(input)));
  } else {
    await call(cognito.send(new AdminRemoveUserFromGroupCommand(input)));
    // Their sessions must be renewed to lose the role.
    await call(cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username: username })));
  }
  return true;
}

async function setEnabled(username: string, enabled: boolean) {
  const input = { UserPoolId, Username: username };
  if (enabled) {
    await call(cognito.send(new AdminEnableUserCommand(input)));
  } else {
    await call(cognito.send(new AdminDisableUserCommand(input)));
    await call(cognito.send(new AdminUserGlobalSignOutCommand(input)));
  }
  return true;
}

async function resendInvite(email: string) {
  await call(
    cognito.send(
      new AdminCreateUserCommand({
        UserPoolId,
        // Resending only accepts the sign-in email, not the generated username.
        Username: email.trim().toLowerCase(),
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    ),
  );
  return true;
}

interface Event {
  fieldName: string;
  arguments: Record<string, never>;
  identity: { username: string };
}

export const handler = async ({ fieldName, arguments: args, identity }: Event) => {
  // Otherwise a manager could lock themselves, and possibly everyone, out.
  const notSelf = () => {
    if (args.username === identity.username) throw new StaffRejectedError('CANNOT_CHANGE_SELF');
  };
  switch (fieldName) {
    case 'listStaff':
      return listStaff(identity.username);
    case 'inviteStaff':
      return inviteStaff(args.email, args.role);
    case 'resendStaffInvite':
      return resendInvite(args.email);
    case 'setStaffRole':
      notSelf();
      return setRole(args.username, args.role);
    case 'setStaffEnabled':
      notSelf();
      return setEnabled(args.username, args.enabled);
    default:
      throw new Error(`unknown field ${fieldName}`);
  }
};
