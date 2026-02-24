const STATES = Object.freeze([
  'INIT',
  'RESEARCH_DONE',
  'DESIGN_DONE',
  'PLAN_DONE',
  'IMPLEMENTED',
  'VALIDATING',
  'RETRYING',
  'PASS',
  'FAILED',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  INIT: new Set(['RESEARCH_DONE']),
  RESEARCH_DONE: new Set(['DESIGN_DONE']),
  DESIGN_DONE: new Set(['PLAN_DONE']),
  PLAN_DONE: new Set(['IMPLEMENTED']),
  IMPLEMENTED: new Set(['VALIDATING']),
  VALIDATING: new Set(['RETRYING', 'PASS', 'FAILED']),
  RETRYING: new Set(['IMPLEMENTED']),
  PASS: new Set([]),
  FAILED: new Set([]),
});

export function getInitialState() {
  return 'INIT';
}

export function validateLifecycleDefinition(definition) {
  const states = Array.isArray(definition?.states) ? definition.states : null;
  const transitions = definition?.transitions && typeof definition.transitions === 'object' ? definition.transitions : null;

  if (!states || !transitions) {
    throw new Error('INVALID_LIFECYCLE_DEFINITION');
  }

  const stateSet = new Set(states);
  if (stateSet.size !== STATES.length) {
    throw new Error('INVALID_LIFECYCLE_DEFINITION');
  }
  for (const state of STATES) {
    if (!stateSet.has(state)) {
      throw new Error('INVALID_LIFECYCLE_DEFINITION');
    }
  }

  for (const state of STATES) {
    const expected = ALLOWED_TRANSITIONS[state];
    const actual = Array.isArray(transitions[state]) ? transitions[state] : null;
    if (!actual) {
      throw new Error('INVALID_LIFECYCLE_DEFINITION');
    }
    const actualSet = new Set(actual);
    if (actualSet.size !== expected.size) {
      throw new Error('INVALID_LIFECYCLE_DEFINITION');
    }
    for (const target of expected) {
      if (!actualSet.has(target)) {
        throw new Error('INVALID_LIFECYCLE_DEFINITION');
      }
    }
  }
}

export function assertValidTransition(prevState, nextState) {
  const allowed = ALLOWED_TRANSITIONS[prevState];
  if (!allowed || !allowed.has(nextState)) {
    throw new Error('INVALID_LIFECYCLE_TRANSITION');
  }
}
