import { createFileRoute } from '@tanstack/react-router';
import { StaffSettings } from '../pos/settings/StaffSettings';

export const Route = createFileRoute('/_staff/pos/settings/staff')({ component: StaffSettings });
