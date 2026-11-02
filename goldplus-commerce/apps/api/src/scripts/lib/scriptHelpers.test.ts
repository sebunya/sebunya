import { describe, expect, it } from 'vitest';
import { actorUserId, rowsOf } from './scriptHelpers';

describe('rowsOf', () => {
  it('reads both driver shapes', () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    expect(rowsOf(undefined)).toEqual([]);
  });
});
describe('actorUserId', () => {
  const id = '0b0e7c1a-1234-4abc-9def-0123456789ab';
  it('requires a uuid only when asked', () => {
    expect(actorUserId(true, 'ACTOR_USER_ID', { ACTOR_USER_ID: ` ${id} ` })).toBe(id);
    expect(() => actorUserId(true, 'ACTOR_USER_ID', {})).toThrow(/ACTOR_USER_ID/);
    expect(() => actorUserId(true, 'ACTOR_USER_ID', { ACTOR_USER_ID: '------------------------------------' })).toThrow();
    expect(actorUserId(false, 'ACTOR_USER_ID', {})).toBe('');
  });
});
