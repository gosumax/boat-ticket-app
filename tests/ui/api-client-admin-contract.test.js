import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/utils/apiClient.js', import.meta.url), 'utf8');

describe('apiClient admin contract smoke', () => {
  it('contains methods required by active admin UI', () => {
    const requiredMethods = [
      'get',
      'createUser',
      'updateUser',
      'deleteUser',
      'resetPassword',
      'createBoat',
      'updateBoat',
      'deleteBoat',
      'getBoatSlots',
      'toggleBoatActive',
      'createBoatSlot',
      'toggleBoatSlotActive',
      'getWorkingZone',
      'saveWorkingZone',
      'clearAllTrips',
    ];

    for (const methodName of requiredMethods) {
      expect(source).toMatch(new RegExp(`\\b${methodName}\\s*\\(`));
    }
  });

  it('maps legacy /users getter to admin users route', () => {
    expect(source).toMatch(/url === '\/users' \? '\/admin\/users' : url/);
  });

  it('uses backend contract for remove-trips-for-deleted-boats endpoint', () => {
    expect(source).toMatch(
      /removeTripsForDeletedBoats\(\)\s*{[\s\S]*\/selling\/trips-for-deleted-boats[\s\S]*method:\s*'DELETE'/,
    );
  });

  it('uses camelCase deleteFutureTrips query in schedule-template delete wrapper', () => {
    expect(source).toMatch(/\?deleteFutureTrips=true/);
  });
});
