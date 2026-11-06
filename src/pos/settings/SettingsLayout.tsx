import { Link, Navigate, Outlet, useLocation } from '@tanstack/react-router';
import { useApp } from '../../appContext';

const TABS = [
  ['/pos/settings/menu', '菜單', 'settings'],
  ['/pos/settings/stations', '出餐站', 'settings'],
  ['/pos/settings/tables', '桌位', 'settings'],
  ['/pos/settings/staff', '員工帳號', 'settings'],
  ['/pos/settings/report', '日結報表', 'report'],
] as const;

export function SettingsLayout() {
  const { can } = useApp();
  const pathname = useLocation({ select: (location) => location.pathname });
  // Hiding the page is for convenience; the server refuses the writes anyway.
  const tabs = TABS.filter(([, , permission]) => can(permission));
  if (tabs.length === 0) return <p className="empty-note">你的角色不能使用店務設定。需要權限請洽店長。</p>;
  const current = TABS.find(([to]) => pathname.startsWith(to));
  if (current && !can(current[2])) return <Navigate to={tabs[0][0]} replace />;
  return (
    <div className="settings">
      <nav className="tabs no-print" aria-label="店務設定">
        {tabs.map(([to, label]) => (
          <Link key={to} to={to} className="tab" activeProps={{ className: 'tab is-selected' }}>
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
