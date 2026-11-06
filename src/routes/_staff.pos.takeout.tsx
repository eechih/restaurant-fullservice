import { createFileRoute } from '@tanstack/react-router';
import { TakeoutView } from '../pos/TakeoutView';

export const Route = createFileRoute('/_staff/pos/takeout')({ component: TakeoutView });
