import { createFileRoute } from '@tanstack/react-router';
import { FloorView } from '../pos/FloorView';

export const Route = createFileRoute('/_staff/pos/')({ component: FloorView });
