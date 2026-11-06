import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAction, useApp } from '../../appContext';
import type { StaffDirectory } from '../../data/repository';
import { ROLE_LABEL, ROLES, type Role, type StaffMember } from '../../domain';
import { Modal } from '../../ui/Modal';

const staffQuery = (staff: StaffDirectory) => queryOptions({ queryKey: ['staff'], queryFn: () => staff.list() });

const ROLE_DUTIES: Record<Role, string> = {
  MANAGER: '全部，包括菜單、出餐站、桌位、帳號和報表',
  SUPERVISOR: '現場調度、核准取消品項、看日結報表',
  CASHIER: '候位、帶位、結帳收款、清桌',
  SERVER: '開桌、點餐、確認掃碼點餐、申請取消、上菜、請求結帳',
  KITCHEN: '只看 KDS 和出菜口，改製作狀態、售完管理',
};

export function StaffSettings() {
  const { staff } = useApp();
  if (!staff) {
    return (
      <section className="settings-panel">
        <p className="empty-note">本機展示模式沒有帳號，部署到 AWS 後才能管理員工帳號。可以用右上角的「角色」切換，試用各角色看到的畫面。</p>
        <RoleGuide />
      </section>
    );
  }
  return <StaffList staff={staff} />;
}

function RoleGuide() {
  return (
    <ul className="field-hint settings-hint role-guide">
      {ROLES.map((role) => (
        <li key={role}>
          <strong>{ROLE_LABEL[role]}</strong>：{ROLE_DUTIES[role]}
        </li>
      ))}
    </ul>
  );
}

function StaffList({ staff }: { staff: StaffDirectory }) {
  const { data, isPending, isError, refetch } = useQuery(staffQuery(staff));
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMember>();

  return (
    <section className="settings-panel staff-settings" aria-label="員工帳號">
      <div className="settings-panel-header">
        <h2>員工帳號</h2>
        <button className="button button-small button-primary" onClick={() => setInviting(true)}>邀請員工</button>
      </div>
      <RoleGuide />
      <ul className="field-hint settings-hint">
        <li>一個帳號可以有多個角色，例如兼任櫃台的服務員。</li>
        <li>變更角色後，對方重新整理頁面就會生效。拿掉角色或停用帳號時，對方會在所有裝置被登出，已開啟的畫面最長 1 小時內失效。</li>
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
            <StaffRow key={member.username} staff={staff} member={member} onEdit={() => setEditing(member)} />
          ))}
        </ul>
      )}
      {inviting && <InviteDialog staff={staff} onClose={() => setInviting(false)} />}
      {editing && <RolesDialog staff={staff} member={editing} onClose={() => setEditing(undefined)} />}
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

function RoleBadges({ roles }: { roles: Role[] }) {
  if (roles.length === 0) return <span className="badge badge-danger">沒有角色</span>;
  return (
    <>
      {ROLES.filter((role) => roles.includes(role)).map((role) => (
        <span key={role} className={role === 'MANAGER' ? 'badge badge-ok' : 'badge'}>
          {ROLE_LABEL[role]}
        </span>
      ))}
    </>
  );
}

function StaffRow({ staff, member, onEdit }: { staff: StaffDirectory; member: StaffMember; onEdit(): void }) {
  const { busy, change } = useStaffChange(staff);
  return (
    <li className={member.enabled ? '' : 'is-disabled'}>
      <div className="settings-list-name">
        {member.email}
        {member.isSelf && <span className="field-hint">（你）</span>}
        <RoleBadges roles={member.roles} />
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
            <button className="link-button" disabled={busy} onClick={onEdit}>
              變更角色
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

function RolePicker({ roles, onChange }: { roles: Role[]; onChange(roles: Role[]): void }) {
  return (
    <div className="chip-row">
      {ROLES.map((role) => {
        const selected = roles.includes(role);
        return (
          <button
            key={role}
            aria-pressed={selected}
            className={selected ? 'chip is-selected' : 'chip'}
            onClick={() => onChange(selected ? roles.filter((candidate) => candidate !== role) : [...roles, role])}
          >
            {ROLE_LABEL[role]}
          </button>
        );
      })}
    </div>
  );
}

function RolesDialog({ staff, member, onClose }: { staff: StaffDirectory; member: StaffMember; onClose(): void }) {
  const { busy, change } = useStaffChange(staff);
  const [roles, setRoles] = useState(member.roles);
  const removed = member.roles.some((role) => !roles.includes(role));
  const save = () =>
    void change(() => staff.setRoles(member.username, roles), `已更新 ${member.email} 的角色`, '變更角色失敗').then(
      (ok) => ok && onClose(),
    );
  return (
    <Modal
      title={`${member.email} 的角色`}
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy || roles.length === 0} onClick={save}>
          {roles.length === 0 ? '請至少選擇一個角色' : '儲存'}
        </button>
      }
    >
      <p className="field-label">角色<span className="field-hint">可以複選</span></p>
      <RolePicker roles={roles} onChange={setRoles} />
      {removed && <p className="warning-note">拿掉角色後，對方會在所有裝置被登出，重新登入後生效。</p>}
    </Modal>
  );
}

function InviteDialog({ staff, onClose }: { staff: StaffDirectory; onClose(): void }) {
  const { busy, change } = useStaffChange(staff);
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Role[]>(['SERVER']);
  const address = email.trim();

  const invite = () =>
    void change(() => staff.invite(address, roles), `已寄出邀請給 ${address}`, '邀請失敗').then(
      (ok) => ok && onClose(),
    );

  return (
    <Modal
      title="邀請員工"
      onClose={onClose}
      footer={
        <button
          className="button button-primary button-wide"
          disabled={busy || !address || roles.length === 0}
          onClick={invite}
        >
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
      <p className="field-label">角色<span className="field-hint">可以複選</span></p>
      <RolePicker roles={roles} onChange={setRoles} />
      <p className="field-hint invite-hint">
        對方會收到含臨時密碼的 Email，7 天內要登入並設定新密碼，過期可以重寄。請另外把網址告訴對方。
      </p>
    </Modal>
  );
}
