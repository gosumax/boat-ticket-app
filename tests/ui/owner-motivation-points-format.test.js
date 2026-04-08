import { describe, expect, it } from 'vitest';

import { formatMotivationPoints } from '../../src/utils/ownerMotivationPoints.js';

describe('owner motivation points formatter', () => {
  it('keeps fractional points instead of rounding them to integers', () => {
    expect(formatMotivationPoints(3.6)).toBe('3,6');
    expect(formatMotivationPoints(3.64)).toBe('3,64');
  });

  it('matches weekly/season precision rules for whole numbers', () => {
    expect(formatMotivationPoints(4)).toBe('4');
    expect(formatMotivationPoints(0)).toBe('0');
  });
});
