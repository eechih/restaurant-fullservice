import { Outlet } from '@tanstack/react-router';
import { useApp } from '../appContext';

export function PosPage() {
  const { catalogState } = useApp();
  if (catalogState === 'loading') return <p className="empty-note">載入中…</p>;
  if (catalogState === 'failed') return <p className="empty-note">無法載入菜單，請重新整理頁面</p>;
  return <Outlet />;
}
