import { createFileRoute } from '@tanstack/react-router';
import { TableView } from '../pos/TableView';

export const Route = createFileRoute('/_staff/pos/table/$tableId')({ component: TablePage });

function TablePage() {
  const { tableId } = Route.useParams();
  return <TableView key={tableId} tableId={tableId} />;
}
