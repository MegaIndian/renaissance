import { describe, expect, it } from 'vitest';

import { greetingKey } from '../src/greeting';

const at = (hour: number): Date => new Date(2026, 10, 17, hour, 30);

describe('greetingKey', () => {
  it('says good morning before noon', () => {
    expect(greetingKey(at(0))).toBe('home.greetingMorning');
    expect(greetingKey(at(11))).toBe('home.greetingMorning');
  });
  it('says good afternoon from noon to five', () => {
    expect(greetingKey(at(12))).toBe('home.greetingAfternoon');
    expect(greetingKey(at(16))).toBe('home.greetingAfternoon');
  });
  it('says good evening from five', () => {
    expect(greetingKey(at(17))).toBe('home.greetingEvening');
    expect(greetingKey(at(23))).toBe('home.greetingEvening');
  });
  it('defaults to now', () => {
    expect(greetingKey()).toMatch(/^home\.greeting(Morning|Afternoon|Evening)$/);
  });
});
