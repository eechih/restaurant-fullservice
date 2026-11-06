import { createFileRoute } from '@tanstack/react-router';
import { ReceiptPage } from '../pos/ReceiptPage';

export const Route = createFileRoute('/_staff/receipt/$checkId')({ component: Receipt });

function Receipt() {
  const { checkId } = Route.useParams();
  return <ReceiptPage checkId={checkId} />;
}
