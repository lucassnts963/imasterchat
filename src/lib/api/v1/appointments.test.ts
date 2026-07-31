import { describe, expect, it } from 'vitest';

import {
  isAppointmentStatus,
  parseSlot,
  serializeAppointment,
  type AppointmentRow,
} from './appointments';

// The booking brain is an LLM (today in n8n, later in-app). These
// tests pin the failures a model actually produces — a date it invented,
// a slot in the past because it lost track of what day it is, an end
// before a start — so they are rejected at the edge instead of reaching
// Postgres as a 500 or, worse, being stored.

const NOW = new Date('2026-08-03T12:00:00.000Z'); // a Monday

describe('parseSlot', () => {
  it('accepts a well-formed future slot', () => {
    const res = parseSlot(
      '2026-08-06T17:00:00.000Z',
      '2026-08-06T17:30:00.000Z',
      NOW,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.slot.startsAt.toISOString()).toBe('2026-08-06T17:00:00.000Z');
      expect(res.slot.endsAt.toISOString()).toBe('2026-08-06T17:30:00.000Z');
    }
  });

  it.each([
    ['not-a-date', '2026-08-06T17:30:00.000Z', 'starts_at_invalid'],
    [undefined, '2026-08-06T17:30:00.000Z', 'starts_at_invalid'],
    [42, '2026-08-06T17:30:00.000Z', 'starts_at_invalid'],
    ['2026-08-06T17:00:00.000Z', 'quinta que vem', 'ends_at_invalid'],
    ['2026-08-06T17:00:00.000Z', null, 'ends_at_invalid'],
  ])('rejects malformed input (%s, %s)', (start, end, expected) => {
    const res = parseSlot(start, end, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(expected);
  });

  it('rejects an end that precedes the start', () => {
    const res = parseSlot(
      '2026-08-06T17:30:00.000Z',
      '2026-08-06T17:00:00.000Z',
      NOW,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('ends_before_starts');
  });

  it('rejects a zero-length slot', () => {
    const at = '2026-08-06T17:00:00.000Z';
    const res = parseSlot(at, at, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('ends_before_starts');
  });

  it('rejects a duration beyond 8 hours', () => {
    // The shape of a units mix-up — nobody books a nine-hour eye exam.
    const res = parseSlot(
      '2026-08-06T09:00:00.000Z',
      '2026-08-06T18:01:00.000Z',
      NOW,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('too_long');
  });

  it('accepts exactly 8 hours', () => {
    const res = parseSlot(
      '2026-08-06T09:00:00.000Z',
      '2026-08-06T17:00:00.000Z',
      NOW,
    );
    expect(res.ok).toBe(true);
  });

  it('rejects a slot in the past', () => {
    // What a model that has lost track of today's date emits — and the
    // reason the current date has to be injected into its prompt.
    const res = parseSlot(
      '2026-07-30T17:00:00.000Z',
      '2026-07-30T17:30:00.000Z',
      NOW,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('in_the_past');
  });

  it('checks the past against the START, not the end', () => {
    // A slot already under way is still in the past for booking
    // purposes; only the start matters.
    const res = parseSlot(
      '2026-08-03T11:30:00.000Z',
      '2026-08-03T12:30:00.000Z',
      NOW,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('in_the_past');
  });
});

describe('isAppointmentStatus', () => {
  it.each(['scheduled', 'completed', 'no_show', 'cancelled'])(
    'accepts %s',
    (s) => expect(isAppointmentStatus(s)).toBe(true),
  );

  it.each(['confirmed', 'CANCELLED', '', null, undefined, 7])(
    'rejects %s',
    (s) => expect(isAppointmentStatus(s)).toBe(false),
  );
});

describe('serializeAppointment', () => {
  it('exposes exactly the public fields, and never account_id', () => {
    const row = {
      id: 'appt-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      starts_at: '2026-08-06T17:00:00.000Z',
      ends_at: '2026-08-06T17:30:00.000Z',
      status: 'scheduled',
      title: 'Exame de vista',
      notes: null,
      google_event_id: 'gcal-1',
      google_calendar_id: 'primary',
      created_via: 'n8n',
      created_at: '2026-08-03T12:00:00.000Z',
      updated_at: '2026-08-03T12:00:00.000Z',
      // Tenancy leak guard: even if a caller widens the select, the
      // serializer must not pass this through.
      account_id: 'acct-secret',
    } as unknown as AppointmentRow;

    const out = serializeAppointment(row) as Record<string, unknown>;
    expect(out).not.toHaveProperty('account_id');
    expect(Object.keys(out).sort()).toEqual(
      [
        'contact_id',
        'conversation_id',
        'created_at',
        'created_via',
        'ends_at',
        'google_calendar_id',
        'google_event_id',
        'id',
        'notes',
        'starts_at',
        'status',
        'title',
        'updated_at',
      ].sort(),
    );
  });
});
