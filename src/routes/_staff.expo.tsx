import { createFileRoute } from '@tanstack/react-router';
import { ExpoPage } from '../expo/ExpoPage';

export const Route = createFileRoute('/_staff/expo')({ component: ExpoPage });
