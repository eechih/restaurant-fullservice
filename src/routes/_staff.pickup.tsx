import { createFileRoute } from '@tanstack/react-router';
import { PickupScreen } from '../pickup/PickupScreen';

export const Route = createFileRoute('/_staff/pickup')({ component: PickupScreen });
