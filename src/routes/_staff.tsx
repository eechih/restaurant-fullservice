import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { loadStaffApp } from '../staffApp';

const StaffApp = lazy(loadStaffApp);

export const Route = createFileRoute('/_staff')({ component: StaffLayout });

function StaffLayout() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="empty-note">載入中…</p>
        </main>
      }
    >
      <StaffApp />
    </Suspense>
  );
}
