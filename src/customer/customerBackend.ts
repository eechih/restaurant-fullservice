import type { CustomerRepository } from '../data/customerRepository';

const outputFiles = import.meta.glob<{ default: Record<string, unknown> }>(
  '../../amplify_outputs.json',
);
const loadOutputs = outputFiles['../../amplify_outputs.json'];

async function load(): Promise<CustomerRepository> {
  if (loadOutputs) {
    const [{ Amplify }, { createAmplifyCustomerRepository }, outputs] = await Promise.all([
      import('aws-amplify'),
      import('../data/amplifyCustomerRepository'),
      loadOutputs(),
    ]);
    Amplify.configure(outputs.default);
    return createAmplifyCustomerRepository();
  }
  const { createDemoCustomerRepository } = await import('../data/demoRepository');
  return createDemoCustomerRepository();
}

let repository: Promise<CustomerRepository> | undefined;

/** Loaded on demand so that the customer entry stays small and free of staff code. */
export function loadCustomerRepository() {
  repository ??= load().catch((error: unknown) => {
    repository = undefined;
    throw error;
  });
  return repository;
}
