import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { DEEPSEEK_URL, deepseekTranslator, type RawTranslation } from '../server/ai';

const answer: RawTranslation = {
  answerable: true, reason: '', assumptions: ['Primary diagnosis used'],
  spec: { from: '', to: '', include: [{ field: 'primary_dx', op: 'in', values: ['PNEUMONIA'] }], exclude: [], groupBy: '', outcomes: ['died'], describe: [] },
};
const reply = (content: string, finish = 'stop', status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('DeepSeek translator', () => {
  it('sends an OpenAI-style JSON-mode request with the schema in the prompt', async () => {
    const fetchMock = vi.fn(async () => reply(JSON.stringify(answer)));
    vi.stubGlobal('fetch', fetchMock);
    const out = await deepseekTranslator({ system: 'CATALOGUE', user: 'How many pneumonia deaths?', apiKey: 'sk-test', model: 'deepseek-flash' });
    expect(out.spec.include[0].field).toBe('primary_dx');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('CATALOGUE');
    expect(body.messages[0].content).toMatch(/json/); // DeepSeek requires the word in the prompt
    expect(body.messages[0].content).toContain('"answerable"');
  });

  it('retries one empty JSON-mode reply, strips code fences, and maps errors', async () => {
    const seq = [reply(''), reply('```json\n' + JSON.stringify(answer) + '\n```')];
    vi.stubGlobal('fetch', vi.fn(async () => seq.shift()!));
    expect((await deepseekTranslator({ system: 's', user: 'u', apiKey: 'k', model: 'deepseek-flash' })).answerable).toBe(true);

    const fail = async (r: Response | Error, msg: RegExp) => {
      vi.stubGlobal('fetch', vi.fn(async () => { if (r instanceof Error) throw r; return r; }));
      await expect(deepseekTranslator({ system: 's', user: 'u', apiKey: 'k', model: 'deepseek-flash' })).rejects.toThrow(msg);
    };
    await fail(new Response('{}', { status: 401 }), /key was rejected/);
    await fail(new Response('{}', { status: 402 }), /no credit/);
    await fail(new Response('{}', { status: 429 }), /busy/);
    await fail(new TypeError('fetch failed'), /Cannot reach/);
    await fail(reply('{"answ', 'length'), /cut off/);
    await fail(reply('not json'), /could not be read/);
  });
});

describe('choosing DeepSeek in the app', () => {
  it('stores a separate key, switches provider and model, and answers through DeepSeek', async () => {
    const db = openDatabase(':memory:');
    const api = createApi(db); // no override: the chosen provider's translator is used
    await api.call('auth.setup', { username: 'a', displayName: 'A', password: 'password1' });
    seedDemo(db, { months: 3 });
    await api.call('ai.configure', { provider: 'deepseek', enabled: true });
    await expect(api.call('ai.ask', { question: 'How many pneumonia admissions died?' })).rejects.toThrow('No DeepSeek API key');
    await expect(api.call('ai.configure', { keyProvider: 'deepseek', apiKey: 'sk-ant-wrong' })).rejects.toThrow(); // too short / wrong shape
    await api.call('ai.configure', { keyProvider: 'deepseek', apiKey: 'sk-' + 'a'.repeat(32), model: 'deepseek-v4-pro' });
    await expect(api.call('ai.configure', { keyProvider: 'deepseek', model: 'gpt-x' })).rejects.toThrow('Unknown model');
    const st = await api.call('ai.status') as any;
    expect(st).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-pro', configured: true, enabled: true });
    expect(st.providers.find((p: any) => p.id === 'anthropic').configured).toBe(false);

    const fetchMock = vi.fn(async () => reply(JSON.stringify(answer)));
    vi.stubGlobal('fetch', fetchMock);
    const t = await api.call('ai.ask', { question: 'How many pneumonia admissions died?' }) as any;
    expect(t.description.join(' ')).toMatch(/Pneumonia/i);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body)).model).toBe('deepseek-v4-pro');
    const log = db.prepare("SELECT summary FROM audit_log WHERE entity = 'ai' ORDER BY id DESC").get() as any;
    expect(log.summary).toContain('DeepSeek');

    // Identifiers are still blocked before anything is sent.
    const mrn = (db.prepare('SELECT mrn FROM patient_identifiers LIMIT 1').get() as any).mrn;
    const n = fetchMock.mock.calls.length;
    await expect(api.call('ai.ask', { question: `What happened to ${mrn}?` })).rejects.toThrow('patient name or MRN');
    expect(fetchMock.mock.calls.length).toBe(n);
  });
});
