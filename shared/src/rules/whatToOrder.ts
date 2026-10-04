import type { ItemRatingValue } from '../schema/rating.js';
import type { RatingDisplay } from './ratings.js';

export type WhatToOrderGroup = 'orderAgain' | 'disagree' | 'skip' | 'unrated';

export interface WhatToOrderInput {
  placeItemId: string;
  onLatestMenu?: boolean | undefined;
  /** One display per visit the item was ordered on (see displayRating). */
  displays: readonly RatingDisplay<ItemRatingValue>[];
}

export interface WhatToOrderResult {
  placeItemId: string;
  group: WhatToOrderGroup;
  notOnLatestMenu: boolean;
  ratedVisitCount: number;
}

/**
 * Place page "What to order":
 * - disagree:   any visit's rating is split
 * - skip:       otherwise, any joint 👎
 * - orderAgain: otherwise, at least one rating and all 😍/👍
 * - unrated:    no ratings
 * Items missing from the latest menu are flagged (shown greyed), not hidden.
 */
export function whatToOrder(input: WhatToOrderInput): WhatToOrderResult {
  const rated = input.displays.filter((d) => d.kind !== 'none');
  let group: WhatToOrderGroup;
  if (rated.some((d) => d.kind === 'split')) group = 'disagree';
  else if (rated.some((d) => d.kind === 'joint' && d.value === 'skip')) group = 'skip';
  else if (rated.length > 0) group = 'orderAgain';
  else group = 'unrated';
  return {
    placeItemId: input.placeItemId,
    group,
    notOnLatestMenu: input.onLatestMenu === false,
    ratedVisitCount: rated.length,
  };
}
