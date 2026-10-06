import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceChange } from '@tedmarks/shared';
import { cleanChanges } from './voiceStructurer.js';

const request = {
  transcript: 'x',
  placeName: 'Doppio Zero',
  participants: [{ id: 'ted', name: 'Ted' }, { id: 'lori', name: 'Lori' }],
  dishes: [{ id: 'vi-1', name: 'Burrata' }],
  orderedBefore: [{ id: 'pi-9', name: 'Funghi pizza' }],
};
const change = (overrides: Partial<VoiceChange>): VoiceChange => ({
  kind: 'itemRating', dishId: null, dishName: null, personId: null, value: null, text: null, evidence: 'quote', ...overrides,
});

test('cleanChanges keeps valid proposals and normalizes ids, values and tags', () => {
  const cleaned = cleanChanges([
    change({ dishId: 'vi-1', value: 'loved' }),
    change({ dishId: 'made-up', dishName: 'Tiramisu', value: 'skip', personId: 'lori' }),
    change({ kind: 'verdict', value: 'wouldReturn', dishName: 'ignored' }),
    change({ kind: 'visitTag', text: ' Patio ' }),
    change({ kind: 'visitNote', text: 'Slow service', value: 'loved' }),
  ], request);
  assert.equal(cleaned.length, 5);
  assert.equal(cleaned[1]!.dishId, null, 'unknown dish id dropped, name kept');
  assert.equal(cleaned[1]!.personId, 'lori');
  assert.equal(cleaned[3]!.text, 'patio');
  assert.equal(cleaned[4]!.value, null, 'notes carry no rating value');
});

test('cleanChanges drops proposals it cannot apply', () => {
  const cleaned = cleanChanges([
    change({ dishId: 'vi-1', value: 'amazing' }),          // not a rating value
    change({ value: 'good' }),                              // rating with no dish
    change({ kind: 'itemNote', dishId: 'vi-1', text: ' ' }), // note with no text
    change({ kind: 'verdict', value: 'loved' }),            // dish value on a verdict
    change({ dishId: 'pi-9', value: 'good', personId: 'stranger' }),
  ], request);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0]!.personId, null, 'unknown person becomes joint');
});
