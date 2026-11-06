import { createFileRoute } from '@tanstack/react-router';
import { ReservationsPage } from '../pos/ReservationsPage';

export const Route = createFileRoute('/_staff/pos/reservations')({ component: ReservationsPage });
