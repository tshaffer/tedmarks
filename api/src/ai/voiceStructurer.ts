import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  VoiceStructureResponse,
  type VoiceChange,
  type VoiceStructureRequest,
} from '@tedmarks/shared';

/** Turns a voice-note transcript into proposed changes. A fake in tests. */
export interface VoiceStructurer {
  structure(request: VoiceStructureRequest): Promise<VoiceChange[]>;
}

export class VoiceDeclinedError extends Error {}

const MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = `You turn a short spoken note about a restaurant visit into proposed updates for Tedmarks, an app where a couple (usually Ted and Lori) records what they thought of restaurants and dishes. The person reviews every proposal before anything is saved, so propose only what the note actually says — leave out anything you'd have to guess.

Kinds of change:
- itemRating: how a dish was. value is "loved" (amazing, favorite, would order every time), "good" (good, solid, fine, would order again) or "skip" (bad, disappointing, wouldn't order again).
- verdict: whether they'd come back to the restaurant. value is "wouldReturn", "tryAgain" (mixed, maybe, worth another try) or "wontReturn".
- itemNote: a remark about a specific dish worth remembering ("crust was soggy", "ask for extra sauce"). text is a short phrase in the speaker's own words.
- visitNote: a remark about the visit or place that isn't about one dish ("service was slow", "great patio").
- visitTag: a short lowercase label for the occasion or place, only when clearly stated ("patio", "noisy", "date night").
- addItem: a dish they ordered that's mentioned without an opinion.

Dishes: when a dish matches one in "Dishes on this visit" or "Ordered here before" (allowing for loose wording — "the pizza" when there's one pizza), set dishId to that id and dishName to the listed name. Otherwise dishId is null and dishName is the dish as said, tidied into a menu-style name. A rated dish needs no separate addItem.

People: opinions are joint ("ours", personId null) unless the note attributes one to a specific person ("Lori loved the tiramisu", "I thought it was too salty" — "I" is the speaker, given below). Then set personId to that participant's id. When two people disagree about a dish, propose one itemRating per person.

evidence quotes the words each change came from. Return an empty list if the note has nothing to record.`;

function describeContext(request: VoiceStructureRequest): string {
  const list = (items: { id: string; name: string }[]) =>
    items.length ? items.map((item) => `- ${item.name} (id: ${item.id})`).join('\n') : '(none)';
  return [
    `Restaurant: ${request.placeName}`,
    `Speaker: ${request.participants[0]?.name ?? 'Ted'}`,
    `People here:\n${list(request.participants)}`,
    `Dishes on this visit:\n${list(request.dishes)}`,
    `Ordered here before:\n${list(request.orderedBefore)}`,
  ].join('\n\n');
}

const VALUES: Partial<Record<VoiceChange['kind'], string[]>> = {
  verdict: ['wontReturn', 'tryAgain', 'wouldReturn'],
  itemRating: ['skip', 'good', 'loved'],
};

/**
 * Drops anything malformed: unknown ids become null (a dish then falls back to its name),
 * ratings need a valid value and a dish, notes and tags need text.
 */
export function cleanChanges(changes: VoiceChange[], request: VoiceStructureRequest): VoiceChange[] {
  const dishIds = new Set([...request.dishes, ...request.orderedBefore].map((d) => d.id));
  const personIds = new Set(request.participants.map((p) => p.id));
  return changes.flatMap((change) => {
    const cleaned: VoiceChange = {
      ...change,
      dishId: change.dishId && dishIds.has(change.dishId) ? change.dishId : null,
      personId: change.personId && personIds.has(change.personId) ? change.personId : null,
      dishName: change.dishName?.trim() || null,
      text: change.text?.trim() || null,
      evidence: change.evidence.trim(),
    };
    const allowed = VALUES[cleaned.kind];
    if (allowed && !allowed.includes(cleaned.value ?? '')) return [];
    if (!allowed) cleaned.value = null;
    const needsDish = cleaned.kind === 'itemRating' || cleaned.kind === 'itemNote' || cleaned.kind === 'addItem';
    if (needsDish && !cleaned.dishId && !cleaned.dishName) return [];
    const needsText = cleaned.kind === 'itemNote' || cleaned.kind === 'visitNote' || cleaned.kind === 'visitTag';
    if (needsText && !cleaned.text) return [];
    if (cleaned.kind === 'visitTag') cleaned.text = cleaned.text!.toLowerCase();
    return [cleaned];
  });
}

/** Claude, called from the server so the API key never reaches the phone. */
export class ClaudeVoiceStructurer implements VoiceStructurer {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async structure(request: VoiceStructureRequest): Promise<VoiceChange[]> {
    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      // If a safety classifier declines, Anthropic re-runs the request on a suitable model.
      fallbacks: 'default',
      // A short extraction the person is waiting on at the table.
      output_config: { effort: 'low', format: betaZodOutputFormat(VoiceStructureResponse) },
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `${describeContext(request)}\n\nVoice note:\n"""\n${request.transcript}\n"""` },
      ],
    });
    if (response.stop_reason === 'refusal') throw new VoiceDeclinedError('Claude declined to structure this note.');
    if (!response.parsed_output) throw new Error(`No structured output (stop reason: ${response.stop_reason})`);
    return cleanChanges(response.parsed_output.changes, request);
  }
}
