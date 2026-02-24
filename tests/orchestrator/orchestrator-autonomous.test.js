import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();

describe('Orchestrator Autonomous Mode', () => {
  let agentsMdContent;
  let processRulesContent;
  let packageJsonContent;

  beforeAll(async () => {
    const agentsMdPath = path.join(ROOT_DIR, 'dev_pipeline', 'AGENTS.md');
    const processRulesPath = path.join(ROOT_DIR, 'dev_pipeline', 'PROCESS_RULES.md');
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');

    agentsMdContent = await fs.readFile(agentsMdPath, 'utf8');
    processRulesContent = await fs.readFile(processRulesPath, 'utf8');
    packageJsonContent = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  });

  describe('No TASK: requirement', () => {
    it('AGENTS.md should NOT require TASK: prefix', () => {
      // The old rule required TASK: prefix - this should NOT exist anymore
      expect(agentsMdContent).not.toContain('Если сообщение не начинается с `TASK:`');
      expect(agentsMdContent).not.toContain('ERROR: Input must start with TASK:');
    });

    it('AGENTS.md should accept commands in any format', () => {
      expect(agentsMdContent).toContain('любом формате');
    });

    it('AGENTS.md should say NO INTERACTIVE QUESTIONS or equivalent', () => {
      const hasNoInteractiveQuestions = 
        agentsMdContent.includes('NO INTERACTIVE QUESTIONS') ||
        agentsMdContent.includes('Никогда не спрашивать подтверждение') ||
        agentsMdContent.includes('без вопросов');
      expect(hasNoInteractiveQuestions).toBe(true);
    });
  });

  describe('No ДЕЛАЙ gate', () => {
    it('PROCESS_RULES.md should say NEVER ask for confirmation', () => {
      expect(processRulesContent).toContain('NEVER ask for confirmation');
    });

    it('PROCESS_RULES.md should say NO INTERACTIVE QUESTIONS', () => {
      expect(processRulesContent).toContain('NO INTERACTIVE QUESTIONS');
    });
  });

  describe('Validate Gate includes e2e', () => {
    it('package.json validate script should include e2e', () => {
      const validateScript = packageJsonContent.scripts?.validate;
      expect(validateScript).toBeDefined();
      const includesE2e = validateScript.includes('e2e') || validateScript.includes('test:all');
      expect(includesE2e).toBe(true);
    });

    it('test:all script should include e2e', () => {
      const testAllScript = packageJsonContent.scripts?.['test:all'];
      expect(testAllScript).toBeDefined();
      expect(testAllScript).toContain('e2e');
    });

    it('e2e script should run playwright', () => {
      const e2eScript = packageJsonContent.scripts?.e2e;
      expect(e2eScript).toBeDefined();
      expect(e2eScript).toContain('playwright');
    });
  });

  describe('Retry mechanism', () => {
    it('AGENTS.md should mention retry loop', () => {
      expect(agentsMdContent).toContain('Retry');
    });

    it('AGENTS.md should mention max-retries configuration', () => {
      expect(agentsMdContent).toContain('max-retries');
    });
  });
});
