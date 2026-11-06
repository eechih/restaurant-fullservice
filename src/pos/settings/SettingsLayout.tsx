import { Link, Outlet } from '@tanstack/react-router';
import { useApp } from '../../appContext';

export function SettingsLayout() {
  const { role } = useApp();
  // Hiding the page is for convenience; the server refuses the writes anyway.
  if (role !== 'MANAGER') {
    return <p className="empty-note">只有店長可以使用店務設定。需要權限請洽店長。</p>;
  }
  return (
    <div className="settings">
      <nav className="tabs no-print" aria-label="店務設定">
        {(
          [
            ['/pos/settings/menu', '菜單'],
            ['/pos/settings/tables', '桌位'],
            ['/pos/settings/staff', '員工帳號'],
            ['/pos/settings/report', '日結報表'],
          ] as const
        ).map(([to, label]) => (
          <Link key={to} to={to} className="tab" activeProps={{ className: 'tab is-selected' }}>
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
