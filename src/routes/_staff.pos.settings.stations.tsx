import { createFileRoute } from '@tanstack/react-router';
import { StationSettings } from '../pos/settings/StationSettings';

export const Route = createFileRoute('/_staff/pos/settings/stations')({ component: StationSettings });
