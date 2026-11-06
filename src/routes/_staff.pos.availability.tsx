import { createFileRoute } from '@tanstack/react-router';
import { AvailabilityPage } from '../pos/AvailabilityPage';

export const Route = createFileRoute('/_staff/pos/availability')({ component: AvailabilityPage });
