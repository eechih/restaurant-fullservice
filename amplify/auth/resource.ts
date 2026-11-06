import { defineAuth } from '@aws-amplify/backend';
import { MANAGER_GROUP } from '../../src/domain';

export const auth = defineAuth({
  loginWith: {
    email: {
      userInvitation: {
        emailSubject: '餐廳 POS 帳號邀請',
        emailBody: (username, code) =>
          `店長已為你建立餐廳 POS 帳號。<br><br>` +
          `帳號：${username()}<br>臨時密碼：${code()}<br><br>` +
          `請開啟店家提供的網址登入，第一次登入時要設定新密碼。臨時密碼 7 天內有效。`,
      },
    },
  },
  groups: [MANAGER_GROUP],
  // The staff accounts function gets its access in backend.ts, not through
  // `access` here, which would make auth and data depend on each other.
});
