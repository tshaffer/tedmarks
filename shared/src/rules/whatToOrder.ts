import type { ItemRatingValue } from '../schema/rating.js';
import type { RatingDisplay } from './ratings.js';

export type WhatToOrderGroup = 'orderAgain' | 'disagree' | 'skip' | 'unrated';

export interface WhatToOrderInput {
  placeItemId: string;
  onLatestMenu?: boolean | undefined;
  /** One display per visit the item was ordered on, newest visit first (see displayRating). */
  displays: readonly RatingDisplay<ItemRatingValue>[];
}

export interface WhatToOrderResult {
  placeItemId: string;
  group: WhatToOrderGroup;
  notOnLatestMenu: boolean;
  ratedVisitCount: number;
}

/**
 * Place page "What to order" — the most recent rating decides (opinions change):
 * - disagree:   it's split
 * - skip:       it's a joint 👎
 * - orderAgain: it's a joint 😍/👍
 * - unrated:    never rated
 * Items missing from the latest menu are flagged (shown greyed), not hidden.
 */
export function whatToOrder(input: WhatToOrderInput): WhatToOrderResult {
  const rated = input.displays.filter((d) => d.kind !== 'none');
  const latest = rated[0];
  let group: WhatToOrderGroup;
  if (!latest) group = 'unrated';
  else if (latest.kind === 'split') group = 'disagree';
  else if (latest.kind === 'joint' && latest.value === 'skip') group = 'skip';
  else group = 'orderAgain';
  return {
    placeItemId: input.placeItemId,
    group,
    notOnLatestMenu: input.onLatestMenu === false,
    ratedVisitCount: rated.length,
  };
}
