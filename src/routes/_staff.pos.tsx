import { createFileRoute } from '@tanstack/react-router';
import { PosPage } from '../pos/PosPage';

export const Route = createFileRoute('/_staff/pos')({ component: PosPage });
