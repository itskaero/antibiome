// ═══════════════════════════════════════════════════════════
//  Natural-language → cohort query (optional, admin-enabled, needs internet).
//
//  What leaves this PC: the typed question and the FIELD CATALOGUE (field names,
//  diagnosis codes, drug/organism names, module options). Never patient rows, results,
//  or identifiers — questions containing a recorded patient name or MRN are blocked.
//  The model only PROPOSES a CohortSpec; it is validated by the same gate as the manual
//  builder, shown to the user in plain words, and runs only after they confirm. Results
//  and their narrative are computed locally — the model never produces statistics.
// ═══════════════════════════════════════════════════════════
import Anthropic from '@anthropic-ai/sdk';
import type { DB } from './db';
import { describeSpec, OPS_BY_KIND, validateSpec, type CohortSpec, type ExplorerField, type Op } from '../shared/explorer';

export const AI_MODEL = 'claude-opus-5-5';

export interface RawTranslation {
  answerable: boolean;
  reason: string;
  assumptions: string[];
  spec: {
    from: string; to: string;
    include: { field: string; op: string; values: string[] }[];
    exclude: { field: string; op: string; values: string[] }[];
    groupBy: string; outcomes: string[]; describe: string[];
  };
}
/** Swappable so tests (and offline builds) never touch the network. */
export type Translator = (args: { system: string; user: string; apiKey: string }) => Promise<RawTranslation>;

export class AiError extends Error {}

const ALL_OPS: Op[] = ['gte', 'lte', 'between', 'is_true', 'is_false', 'in', 'not_in', 'includes_any', 'includes_all', 'excludes', 'exists', 'missing'];
const COND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['field', 'op', 'values'],
  properties: {
    field: { type: 'string', description: 'A field id from the catalogue' },
    op: { type: 'string', enum: ALL_OPS },
    values: { type: 'array', items: { type: 'string' }, description: 'Option codes, or numbers as strings; [] for operators without a value; two numbers for between' },
  },
};
export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answerable', 'reason', 'assumptions', 'spec'],
  properties: {
    answerable: { type: 'boolean' },
    reason: { type: 'string', description: 'Why not answerable, or empty' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'Every interpretation choice the clinician should check' },
    spec: {
      type: 'object', additionalProperties: false, required: ['from', 'to', 'include', 'exclude', 'groupBy', 'outcomes', 'describe'],
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD or empty' },
        to: { type: 'string', description: 'YYYY-MM-DD or empty' },
        include: { type: 'array', items: COND_SCHEMA },
        exclude: { type: 'array', items: COND_SCHEMA },
        groupBy: { type: 'string', description: 'Field id or empty' },
        outcomes: { type: 'array', items: { type: 'string' } },
        describe: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export function catalogueText(fields: ExplorerField[]): string {
  const groups: Record<string, ExplorerField[]> = {};
  fields.forEach(f => (groups[f.group] ??= []).push(f));
  return Object.entries(groups).map(([g, list]) => `## ${g}\n` + list.map(f => {
    const opts = f.options?.length ? ` options: ${f.options.map(o => (f.optionLabels?.[o] && f.optionLabels[o] !== o ? `${o}=${f.optionLabels[o]}` : o)).join(' | ')}` : '';
    return `- ${f.id} [${f.kind}${f.unit ? `, ${f.unit}` : ''}] ${f.label}.${opts} (operators: ${OPS_BY_KIND[f.kind].join(', ')})`;
  }).join('\n')).join('\n\n');
}

export function systemPrompt(fields: ExplorerField[]): string {
  return `You translate questions from paediatric intensive care (PICU) clinicians into a cohort query for a local research database. You never see patient data and you never answer the question yourself: the app runs your query locally, shows it to the clinician for confirmation, and computes all numbers.

Rules:
- Use only field ids and option codes from the catalogue below. Never invent fields or values.
- One admission is one row. "include" conditions are ANDed; any "exclude" condition removes an admission.
- Diagnoses: use primary_dx for "admitted with X"; use any_dx for "had X" when secondary diagnoses should count, and say which you chose in assumptions.
- Relative dates ("last 6 months", "this year") are resolved against the date given with the question, as YYYY-MM-DD.
- Put the measures the question asks about in "outcomes" (numbers or yes/no fields) and other variables of interest in "describe". If the question compares groups, set "groupBy" to the yes/no or category field that defines them.
- For "how many…" questions an empty outcomes list is fine; the cohort size is always reported.
- Causal questions ("does X improve Y") are answered as a comparison of groups; add an assumption that the result will show association only.
- Set answerable=false (with a short reason) for: questions about a specific identifiable patient, requests for treatment advice for a patient, or anything the catalogue cannot express. Otherwise answerable=true and reason empty.
- List every interpretation choice in "assumptions" in plain clinical language.

# Field catalogue
${catalogueText(fields)}`;
}

/** Default translator: Claude via the Anthropic SDK, structured JSON output, refusal fallbacks on. */
export const claudeTranslator: Translator = async ({ system, user, apiKey }) => {
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      // The catalogue is stable between questions, so cache it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('The AI API key was rejected. An administrator can update it in Settings.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('The AI service is busy (rate limited). Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Cannot reach the AI service. Check the internet connection — the rest of the app works offline.');
    if (e instanceof Anthropic.APIError) throw new AiError(`AI service error (${e.status ?? 'unknown'}). Use the query builder instead.`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new AiError('The AI service declined this question. Rephrase it, or use the query builder.');
  if (response.stop_reason === 'max_tokens') throw new AiError('The AI response was cut off. Try a shorter question.');
  const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
  try { return JSON.parse(text) as RawTranslation; } catch { throw new AiError('The AI response could not be read. Use the query builder instead.'); }
};

/** Map the model's flat condition shape onto the Explorer's typed conditions (validation happens after). */
export function toSpec(raw: RawTranslation['spec'], fields: ExplorerField[]): CohortSpec {
  const kindOf = (id: string) => fields.find(f => f.id === id)?.kind;
  const cond = (c: RawTranslation['spec']['include'][number]) => {
    const op = c.op as Op;
    const kind = kindOf(c.field);
    if (op === 'gte' || op === 'lte') return { field: c.field, op, value: Number(c.values[0]) };
    if (op === 'between') return { field: c.field, op, value: c.values.slice(0, 2).map(Number) };
    if (['in', 'not_in', 'includes_any', 'includes_all', 'excludes'].includes(op)) return { field: c.field, op, value: c.values };
    return { field: c.field, op: kind === 'boolean' && op === 'in' ? 'is_true' : op };
  };
  return {
    from: raw.from || null, to: raw.to || null,
    include: (raw.include ?? []).map(cond), exclude: (raw.exclude ?? []).map(cond),
    groupBy: raw.groupBy || null, outcomes: raw.outcomes ?? [], describe: raw.describe ?? [], regression: null,
  };
}

/** Block questions that contain a recorded patient's name or MRN. */
export function containsIdentifier(db: DB, question: string): boolean {
  const q = question.toLowerCase();
  const rows = db.prepare('SELECT mrn, name FROM patient_identifiers').all() as { mrn: string; name: string | null }[];
  return rows.some(r => (r.mrn && r.mrn.length >= 3 && q.includes(r.mrn.toLowerCase()))
    || (r.name && r.name.replace(/\(demo\)/i, '').trim().split(/\s+/).filter(w => w.length >= 4).some(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(question))));
}

export interface Translation { spec: CohortSpec; description: string[]; assumptions: string[] }

/** Translate, validate, and (once) ask the model to repair a spec the validator rejected. */
export async function translateQuestion(question: string, fields: ExplorerField[], today: string, apiKey: string, translator: Translator): Promise<Translation> {
  const system = systemPrompt(fields);
  let user = `Today is ${today}.\nQuestion: ${question}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await translator({ system, user, apiKey });
    if (!raw?.answerable) throw new AiError(raw?.reason ? `Not answerable from the recorded data: ${raw.reason}` : 'The question could not be translated into a query.');
    try {
      const spec = validateSpec(toSpec(raw.spec, fields), fields);
      return { spec, description: describeSpec(spec, fields), assumptions: (raw.assumptions ?? []).slice(0, 8).map(a => String(a).slice(0, 300)) };
    } catch (e: any) {
      if (attempt === 1) throw new AiError(`The proposed query was invalid (${e.message}). Rephrase the question or use the query builder.`);
      user = `Today is ${today}.\nQuestion: ${question}\n\nYour previous query was rejected by the validator: "${e.message}". Previous query: ${JSON.stringify(raw.spec)}\nReturn a corrected query using only catalogue fields, operators and option codes.`;
    }
  }
  throw new AiError('Translation failed');
}
