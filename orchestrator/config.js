export const ORCHESTRATOR_CONFIG = Object.freeze({
  model: process.env.ORCHESTRATOR_MODEL || 'gpt-4.1-mini',
  testCommand: 'npm run validate',
});

export default ORCHESTRATOR_CONFIG;
