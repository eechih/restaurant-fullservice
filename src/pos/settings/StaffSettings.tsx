import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAction, useApp } from '../../appContext';
import type { StaffDirectory } from '../../data/repository';
import type { StaffMember, StaffRole } from '../../domain';
import { Modal } from '../../ui/Modal';

const staffQuery = (staff: StaffDirectory) =>
  queryOptions({ queryKey: ['staff'], queryFn: () => staff.list() });

const ROLE_LABEL: Record<StaffRole, string> = { MANAGER: '店長', STAFF: '員工' };

export function StaffSettings() {
  const { staff } = useApp();
  if (!staff) return <p className="empty-note">本機展示模式沒有帳號，部署到 AWS 後才能管理員工帳號。</p>;
  return <StaffList staff={staff} />;
}

function StaffList({ staff }: { staff: StaffDirectory }) {
  const { data, isPending, isError, refetch } = useQuery(staffQuery(staff));
  const [inviting, setInviting] = useState(false);

  return (
    <section className="settings-panel staff-settings" aria-label="員工帳號">
      <div className="settings-panel-header">
        <h2>員工帳號</h2>
        <button className="button button-small button-primary" onClick={() => setInviting(true)}>邀請員工</button>
      </div>
      <ul className="field-hint settings-hint">
        <li>店長可以修改菜單、桌位和員工帳號；員工可以點餐、收款、操作廚房和售完管理。</li>
        <li>變更角色後，對方重新整理頁面就會生效。</li>
        <li>停用帳號或取消店長時，對方會在所有裝置被登出。已開啟的畫面最長 1 小時內失效。</li>
      </ul>
      {isPending ? (
        <p className="empty-note">載入中…</p>
      ) : isError ? (
        <p className="empty-note">
          無法載入帳號。<button className="link-button" onClick={() => void refetch()}>再試一次</button>
        </p>
      ) : (
        <ul className="settings-list">
          {data.map((member) => (
            <StaffRow key={member.username} staff={staff} member={member} />
          ))}
        </ul>
      )}
      {inviting && <InviteDialog staff={staff} onClose={() => setInviting(false)} />}
    </section>
  );
}

function useStaffChange(staff: StaffDirectory) {
  const queryClient = useQueryClient();
  const { notify } = useApp();
  const { busy, run } = useAction();
  const change = (action: () => Promise<void>, done: string, failure: string) =>
    run(async () => {
      try {
        await action();
        notify(done);
      } finally {
        await queryClient.invalidateQueries({ queryKey: staffQuery(staff).queryKey });
      }
    }, failure);
  return { busy, change };
}

function StaffRow({ staff, member }: { staff: StaffDirectory; member: StaffMember }) {
  const { busy, change } = useStaffChange(staff);
  const otherRole: StaffRole = member.role === 'MANAGER' ? 'STAFF' : 'MANAGER';

  return (
    <li className={member.enabled ? '' : 'is-disabled'}>
      <div className="settings-list-name">
        {member.email}
        {member.isSelf && <span className="field-hint">（你）</span>}
        <span className={member.role === 'MANAGER' ? 'badge badge-ok' : 'badge'}>{ROLE_LABEL[member.role]}</span>
        {!member.enabled && <span className="badge badge-danger">已停用</span>}
        {member.enabled && member.invited && <span className="badge badge-warn">尚未登入</span>}
      </div>
      {!member.isSelf && (
        <>
          {member.enabled && member.invited && (
            <button
              className="link-button"
              disabled={busy}
              onClick={() =>
                change(() => staff.resendInvite(member.email), `已重寄邀請給 ${member.email}`, '重寄邀請失敗')
              }
            >
              重寄邀請
            </button>
          )}
          {member.enabled && (
            <button
              className="link-button"
              disabled={busy}
              onClick={() =>
                change(
                  () => staff.setRole(member.username, otherRole),
                  `${member.email} 已改為${ROLE_LABEL[otherRole]}`,
                  '變更角色失敗',
                )
              }
            >
              改為{ROLE_LABEL[otherRole]}
            </button>
          )}
          <button
            className={member.enabled ? 'link-button link-danger' : 'link-button'}
            disabled={busy}
            onClick={() =>
              change(
                () => staff.setEnabled(member.username, !member.enabled),
                member.enabled ? `已停用 ${member.email}` : `已啟用 ${member.email}`,
                member.enabled ? '停用失敗' : '啟用失敗',
              )
            }
          >
            {member.enabled ? '停用' : '啟用'}
          </button>
        </>
      )}
    </li>
  );
}

function InviteDialog({ staff, onClose }: { staff: StaffDirectory; onClose(): void }) {
  const { busy, change } = useStaffChange(staff);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');
  const address = email.trim();

  const invite = () =>
    void change(() => staff.invite(address, role), `已寄出邀請給 ${address}`, '邀請失敗').then(
      (ok) => ok && onClose(),
    );

  return (
    <Modal
      title="邀請員工"
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy || !address} onClick={invite}>
          {busy ? '寄送中…' : '寄出邀請'}
        </button>
      }
    >
      <label className="field-label" htmlFor="invite-email">Email</label>
      <input
        id="invite-email"
        className="text-input"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <p className="field-label">角色</p>
      <div className="chip-row">
        {(['STAFF', 'MANAGER'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={role === value}
            className={role === value ? 'chip is-selected' : 'chip'}
            onClick={() => setRole(value)}
          >
            {ROLE_LABEL[value]}
          </button>
        ))}
      </div>
      <p className="field-hint invite-hint">
        對方會收到含臨時密碼的 Email，7 天內要登入並設定新密碼，過期可以重寄。請另外把網址告訴對方。
      </p>
    </Modal>
  );
}
