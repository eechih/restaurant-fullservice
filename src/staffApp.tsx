import type { ComponentType } from 'react';

const outputFiles = import.meta.glob<{ default: Record<string, unknown> }>(
  '../amplify_outputs.json',
);
const loadOutputs = outputFiles['../amplify_outputs.json'];

/** Picks the backend. Without a deployed backend, the app runs on browser storage. */
export async function loadStaffApp(): Promise<{ default: ComponentType }> {
  if (loadOutputs) {
    const [{ AmplifyRoot }, outputs] = await Promise.all([import('./AmplifyRoot'), loadOutputs()]);
    return { default: () => <AmplifyRoot outputs={outputs.default} /> };
  }
  const { DemoRoot } = await import('./DemoRoot');
  return { default: DemoRoot };
}
