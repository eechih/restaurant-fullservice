import { createFileRoute } from '@tanstack/react-router';
import { MenuSettings } from '../pos/settings/MenuSettings';

export const Route = createFileRoute('/_staff/pos/settings/menu')({ component: MenuSettings });
