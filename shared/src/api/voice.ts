import { z } from 'zod';

/** A dish or person Claude may refer to, by the id the phone uses. */
const Named = z.object({ id: z.string().min(1), name: z.string().min(1) });

/** POST /ai/voice — a hold-to-talk transcript plus what the phone knows about the visit. */
export const VoiceStructureRequest = z.object({
  transcript: z.string().trim().min(1).max(5000),
  placeName: z.string().min(1),
  /** Who's at the visit (Ted, Lori, guests). */
  participants: z.array(Named).max(20),
  /** Dishes already in our order on this visit (VisitItem ids). */
  dishes: z.array(Named).max(100),
  /** Dishes from earlier visits here (PlaceItem ids), to recognize names. */
  orderedBefore: z.array(Named).max(200),
});
export type VoiceStructureRequest = z.infer<typeof VoiceStructureRequest>;

export const VoiceChangeKind = z.enum(['verdict', 'itemRating', 'itemNote', 'visitNote', 'visitTag', 'addItem']);
export type VoiceChangeKind = z.infer<typeof VoiceChangeKind>;

/**
 * One proposed change. The phone shows these for confirmation (never auto-applied) and
 * turns the kept ones into ratings, dishes, notes and tags.
 */
export const VoiceChange = z.object({
  kind: VoiceChangeKind,
  /** A dish from `dishes` (VisitItem id) or `orderedBefore` (PlaceItem id), when it matches one. */
  dishId: z.string().nullable(),
  /** The dish as named — used to add it when it matched nothing. */
  dishName: z.string().nullable(),
  /** A participant id when the opinion is one person's; null = ours (joint). */
  personId: z.string().nullable(),
  /** verdict: wontReturn | tryAgain | wouldReturn · itemRating: skip | good | loved */
  value: z.string().nullable(),
  /** Note text or tag. */
  text: z.string().nullable(),
  /** The words this came from, quoted from the transcript. */
  evidence: z.string(),
});
export type VoiceChange = z.infer<typeof VoiceChange>;

export const VoiceStructureResponse = z.object({ changes: z.array(VoiceChange) });
export type VoiceStructureResponse = z.infer<typeof VoiceStructureResponse>;
