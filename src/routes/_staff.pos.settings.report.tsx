import { createFileRoute } from '@tanstack/react-router';
import { DailyReportPage } from '../pos/settings/DailyReportPage';

export const Route = createFileRoute('/_staff/pos/settings/report')({ component: DailyReportPage });
