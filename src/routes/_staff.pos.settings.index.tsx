import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_staff/pos/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/pos/settings/menu' });
  },
});
