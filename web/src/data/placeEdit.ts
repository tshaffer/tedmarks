import type { MealsServed, PlaceStatus } from '@tedmarks/shared';
import type { TedmarksRecords } from './TedmarksData.js';
import { inverse } from './undo.js';
import { TED, type Changes } from './visitWrites.js';

/** The Edit place dialog's fields (Figma W2). */
export interface PlaceEdit {
  name: string;
  /** One of our subtypes, or none (Google's type is shown instead). */
  subtypeId: string | null;
  status: PlaceStatus;
  tags: string[];
  review: string;
  /** Set by hand, or null to go by Google's hours. */
  meals: MealsServed | null;
}

export function placeEditOf(data: TedmarksRecords, placeId: string): PlaceEdit {
  const p = data.places.get(placeId)!;
  const meals = p.attributes?.kind === 'restaurant' ? p.attributes.mealsServed : null;
  return { name: p.name, subtypeId: p.subtypeId ?? null, status: p.status, tags: p.tags, review: p.review ?? '', meals };
}

/** Only the fields that changed; returns the changes and their undo. */
export function planPlaceEdit(data: TedmarksRecords, placeId: string, edit: PlaceEdit, now = new Date().toISOString()): { changes: Changes; undo: (later: string) => Changes } {
  const before = placeEditOf(data, placeId);
  const fields: Record<string, unknown> = {};
  const name = edit.name.trim();
  if (name && name !== before.name) fields.name = name;
  if (edit.subtypeId !== before.subtypeId) fields.subtypeId = edit.subtypeId;
  if (edit.status !== before.status) fields.status = edit.status;
  const tags = [...new Set(edit.tags.map((t) => t.trim()).filter(Boolean))];
  if (tags.join('\n') !== before.tags.join('\n')) fields.tags = tags;
  const review = edit.review.trim();
  if (review !== before.review) fields.review = review || null;
  if (JSON.stringify(edit.meals) !== JSON.stringify(before.meals)) fields.attributes = edit.meals ? { kind: 'restaurant', mealsServed: edit.meals } : null;
  const changes: Changes = Object.keys(fields).length ? { places: [{ id: placeId, modifiedAt: now, modifiedBy: TED, ...fields }] } : {};
  return { changes, undo: (later) => inverse(data, changes, later) };
}

/** Our review, deleted (with its undo). */
export function planReviewDelete(data: TedmarksRecords, placeId: string, now = new Date().toISOString()) {
  const changes: Changes = { places: [{ id: placeId, modifiedAt: now, modifiedBy: TED, review: null }] };
  return { changes, undo: (later: string) => inverse(data, changes, later) };
}
