import { createFileRoute } from '@tanstack/react-router';
import { QrCodesPage } from '../pos/QrCodesPage';

export const Route = createFileRoute('/_staff/pos/qr')({ component: QrCodesPage });
