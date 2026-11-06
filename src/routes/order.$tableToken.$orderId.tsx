import { createFileRoute } from '@tanstack/react-router';
import { OrderStatusPage } from '../customer/OrderStatusPage';

export const Route = createFileRoute('/order/$tableToken/$orderId')({
  component: OrderStatusPage,
});
