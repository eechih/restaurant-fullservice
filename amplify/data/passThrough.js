// Delivers a mutation's result to subscribers unchanged.
export function request() {
  return { payload: null };
}

export function response(ctx) {
  return ctx.result;
}
