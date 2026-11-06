import { createFileRoute } from '@tanstack/react-router';
import { StoreSettingsPage } from '../pos/settings/StoreSettingsPage';

export const Route = createFileRoute('/_staff/pos/settings/store')({ component: StoreSettingsPage });
