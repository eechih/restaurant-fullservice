import { createFileRoute } from '@tanstack/react-router';
import { KdsPage } from '../kds/KdsPage';

export const Route = createFileRoute('/_staff/kds')({ component: KdsPage });
