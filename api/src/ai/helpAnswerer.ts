import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { HelpAskResponse, helpTopics, type HelpAskRequest } from '@tedmarks/shared';

/** Answers questions about using Tedmarks from the help topics. A fake in tests. */
export interface HelpAnswerer {
  answer(request: HelpAskRequest): Promise<HelpAskResponse>;
}

const MODEL = 'claude-sonnet-5-5';
/** Earlier questions sent for context (follow-ups). */
const MAX_HISTORY = 6;

const SYSTEM_PROMPT = `You are the Help on the Tedmarks website. Tedmarks is a restaurant journal for a couple, Ted and Lori: an iPhone app for recording visits at the restaurant (what they ordered, how it was), and a website for planning where to eat and looking back.

Answer the question using ONLY the help topics below. Don't invent features, buttons or behavior they don't describe; if they don't cover the question, say so plainly ("Help doesn't cover that") rather than guessing. Keep answers short and practical — a few sentences or a short list — and name buttons and pages the way the topics do. Use American English. Markdown is fine.

Earlier questions and answers may be included for follow-ups ("and on the phone?"); use them for context, but base the answer on the topics.

In topics, list the slugs (in [brackets] below) of the topics you drew on, most relevant first; none if the topics don't cover it.`;

/** The topics as one block (cached with the instructions: the same on every question). */
export function helpContext(): string {
  return helpTopics.map((t) => `### [${t.slug}] ${t.title} (${t.category})\n\n${t.body}`).join('\n\n---\n\n');
}

/** Keeps only slugs of real topics, once each. */
export function cleanTopics(slugs: string[]): string[] {
  const known = new Set(helpTopics.map((t) => t.slug));
  return [...new Set(slugs)].filter((slug) => known.has(slug));
}

export class ClaudeHelpAnswerer implements HelpAnswerer {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async answer(request: HelpAskRequest): Promise<HelpAskResponse> {
    const history = request.history.slice(-MAX_HISTORY).flatMap((turn): Anthropic.Beta.BetaMessageParam[] => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer },
    ]);
    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(HelpAskResponse) },
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: helpContext(), cache_control: { type: 'ephemeral' } },
      ],
      messages: [...history, { role: 'user', content: request.question }],
    });
    if (!response.parsed_output) throw new Error(`No structured output (stop reason: ${response.stop_reason})`);
    return { answer: response.parsed_output.answer, topics: cleanTopics(response.parsed_output.topics) };
  }
}
