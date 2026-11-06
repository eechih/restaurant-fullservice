import { createFileRoute } from '@tanstack/react-router';
import { TableSettings } from '../pos/settings/TableSettings';

export const Route = createFileRoute('/_staff/pos/settings/tables')({ component: TableSettings });
