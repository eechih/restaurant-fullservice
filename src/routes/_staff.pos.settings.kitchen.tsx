import { createFileRoute } from '@tanstack/react-router';
import { KitchenReportPage } from '../pos/settings/KitchenReportPage';

export const Route = createFileRoute('/_staff/pos/settings/kitchen')({ component: KitchenReportPage });
