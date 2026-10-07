/**
 * A "been there" place left with no visits (its only visit was deleted or discarded):
 * - a review or our own rating        → stays been there (we went; the visits just weren't recorded)
 * - we want to go (interest)          → becomes want to go
 * - a menu or a note about the place  → becomes want to go (keeps what we saved)
 * - nothing else                      → deleted (it only existed for that visit)
 *
 * Mirrored in Swift (TedmarksKit); both are tested against fixtures/place-without-visits-cases.json.
 */
export interface PlaceWithoutVisitsInput {
  status: 'wantToGo' | 'beenThere';
  hasInterest: boolean;
  hasReview: boolean;
  hasMenuOrNotes: boolean;
}

export type PlaceWithoutVisitsAction = 'keep' | 'wantToGo' | 'delete';

export function placeWithoutVisits(input: PlaceWithoutVisitsInput): PlaceWithoutVisitsAction {
  if (input.status !== 'beenThere') return 'keep';
  if (input.hasReview) return 'keep';
  if (input.hasInterest) return 'wantToGo';
  if (input.hasMenuOrNotes) return 'wantToGo';
  return 'delete';
}
