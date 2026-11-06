import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut, type AuthSession } from 'aws-amplify/auth';
import { I18n } from 'aws-amplify/utils';
import { useEffect, useState } from 'react';
import { App } from './App';
import { createAmplifyRepository } from './data/amplifyRepository';
import type { Repository } from './data/repository';
import { MANAGER_GROUP, type StaffRole } from './domain';

I18n.putVocabularies({
  'zh-TW': {
    'Sign in': '登入',
    'Sign In': '登入',
    'Signing in': '登入中',
    Email: 'Email',
    'Enter your Email': '請輸入 Email',
    Password: '密碼',
    'Enter your Password': '請輸入密碼',
    'Forgot your password?': '忘記密碼？',
    'Reset Password': '重設密碼',
    'Send code': '傳送驗證碼',
    'Back to Sign In': '返回登入',
    'Change Password': '變更密碼',
    Changing: '變更中',
    'Confirm Password': '確認密碼',
    'Please confirm your Password': '請再次輸入密碼',
    'Incorrect username or password.': 'Email 或密碼不正確。',
    'User does not exist.': 'Email 或密碼不正確。',
  },
});
I18n.setLanguage('zh-TW');

const roleOf = (session: AuthSession): StaffRole => {
  const groups = session.tokens?.accessToken.payload['cognito:groups'];
  return Array.isArray(groups) && groups.includes(MANAGER_GROUP) ? 'MANAGER' : 'STAFF';
};

/**
 * Starts from the stored session so the app opens at once, then renews it, so a
 * role a manager just changed applies when the page is reloaded.
 */
function useRole(userId: string | undefined) {
  const [role, setRole] = useState<StaffRole>();
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const apply = (session: AuthSession) => {
      if (active) setRole(roleOf(session));
    };
    void fetchAuthSession().then(apply, () => undefined);
    // Offline fails here and keeps the stored session.
    fetchAuthSession({ forceRefresh: true }).then((session) => {
      // Amplify answers a revoked session, such as a disabled account or a
      // removed manager, with no tokens rather than an error.
      if (!session.tokens) void signOut();
      else apply(session);
    }, () => undefined);
    return () => {
      active = false;
    };
  }, [userId]);
  return role;
}

function SignedIn({ repository, userId, userLabel, onSignOut }: {
  repository: Repository;
  userId?: string;
  userLabel?: string;
  onSignOut?: () => void;
}) {
  const role = useRole(userId);
  if (!role) return <p className="empty-note page">載入中…</p>;
  return <App repository={repository} role={role} userLabel={userLabel} onSignOut={onSignOut} />;
}

export function AmplifyRoot({ outputs }: { outputs: Record<string, unknown> }) {
  const [repository] = useState(() => {
    Amplify.configure(outputs);
    return createAmplifyRepository();
  });

  return (
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <SignedIn
          repository={repository}
          userId={user?.userId}
          userLabel={user?.signInDetails?.loginId}
          onSignOut={signOut}
        />
      )}
    </Authenticator>
  );
}
