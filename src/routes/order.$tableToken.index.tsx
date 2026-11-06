import { createFileRoute } from '@tanstack/react-router';
import { MenuPage } from '../customer/MenuPage';

export const Route = createFileRoute('/order/$tableToken/')({ component: MenuPage });
