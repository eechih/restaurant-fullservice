import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { loadCustomerRepository } from '../customer/customerBackend';
import { tableQuery } from '../customer/queries';

// The customer entry. It sits outside the staff layout, so it needs no sign-in
// and does not download staff code.
export const Route = createFileRoute('/order/$tableToken')({
  loader: async () => ({ repository: await loadCustomerRepository() }),
  component: CustomerLayout,
  pendingComponent: () => <CustomerMessage role="status">載入中…</CustomerMessage>,
  errorComponent: () => <CustomerMessage role="alert">無法載入，請重新整理頁面</CustomerMessage>,
});

function CustomerMessage({ role, children }: { role: 'status' | 'alert'; children: string }) {
  return (
    <div className="customer">
      <main className="customer-main">
        <p className="empty-note" role={role}>
          {children}
        </p>
      </main>
    </div>
  );
}

function CustomerLayout() {
  const { repository } = Route.useLoaderData();
  const { tableToken } = Route.useParams();
  const table = useQuery(tableQuery(repository, tableToken));

  if (table.isPending) return <CustomerMessage role="status">載入中…</CustomerMessage>;
  if (table.isError && !table.data) {
    return <CustomerMessage role="alert">無法連線，請稍後重新整理頁面</CustomerMessage>;
  }
  if (!table.data) {
    return <CustomerMessage role="alert">這個 QR Code 已失效，請洽現場人員</CustomerMessage>;
  }
  return (
    <div className="customer">
      <header className="customer-header">
        <h1>{table.data.takeout ? '外帶點餐' : `${table.data.name} 桌點餐`}</h1>
      </header>
      <Outlet />
    </div>
  );
}
