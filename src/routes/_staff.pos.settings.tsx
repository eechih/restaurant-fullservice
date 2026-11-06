import { createFileRoute } from '@tanstack/react-router';
import { SettingsLayout } from '../pos/settings/SettingsLayout';

export const Route = createFileRoute('/_staff/pos/settings')({ component: SettingsLayout });
