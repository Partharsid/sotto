import type { Doc } from './store';

// ── Is this sentence a question for me? ──────────────────────────────────────────────────────
const ASKING = /^(so[, ]+)?(tell me|describe|explain|walk me through|talk (to me )?about|give me|share|how|what|why|when|where|who|which|can you|could you|would you|will you|do you|did you|have you|are you|is there|what's|how's)\b/i;

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.length >= 12 && (/\?\s*$/.test(t) || ASKING.test(t));
}

// ── Pick the CV / notes passages that matter for this question (BM25-style) ───────────────────
const STOP = new Set('a an the and or but if of to in on at for with from by is are was were be been it this that these those you your i me my we our they their what which who how why when where do does did can could would should tell about describe explain give example'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

// Interviewers rarely use the same words as a CV does.
const SYN: Record<string, string[]> = {
  database: ['sql', 'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'nosql'], databases: ['sql', 'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'nosql'],
  education: ['university', 'college', 'degree', 'bachelor', 'master', 'school', 'graduated'], degree: ['university', 'college', 'bachelor', 'master'],
  performance: ['latency', 'faster', 'optimized', 'reduced', 'throughput', 'speed', 'scaled'], improve: ['reduced', 'increased', 'optimized', 'improved'],
  team: ['led', 'mentored', 'managed', 'collaborated'], lead: ['led', 'mentored', 'managed'], leadership: ['led', 'mentored', 'managed'],
  skills: ['skills', 'technologies', 'stack', 'tools'], stack: ['skills', 'technologies', 'tools'],
  language: ['go', 'python', 'java', 'javascript', 'typescript', 'rust', 'skills'], languages: ['go', 'python', 'java', 'javascript', 'typescript', 'rust', 'skills'],
  cloud: ['aws', 'gcp', 'azure', 'kubernetes', 'docker'], project: ['built', 'developed', 'created', 'implemented'],
  challenge: ['migration', 'reduced', 'incident', 'led', 'solved'], experience: ['worked', 'built', 'led'], work: ['worked', 'built'],
};

function chunks(text: string, target = 280): string[] {
  const parts = text.split(/\n{2,}|\n(?=[A-Z][A-Za-z &/]{2,30}\n)/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + '\n' + p).length > target) { out.push(cur); cur = p; } else cur = cur ? cur + '\n' + p : p;
  }
  if (cur) out.push(cur);
  return out.flatMap((c) => (c.length > target * 2 ? c.match(new RegExp(`[\\s\\S]{1,${target * 2}}`, 'g')) ?? [c] : [c]));
}

/** Up to k+2 passages: the opening of the first enabled document (name, headline, summary) plus the best matches. */
export function context(question: string, docs: Doc[], k = 4): string[] {
  const on = docs.filter((d) => d.on);
  if (!on.length) return [];
  const pool = on.flatMap((d, di) => chunks(d.text).map((c, i) => ({ c, head: di === 0 && i < 2 })));
  const q = words(question).flatMap((w) => [w, ...(SYN[w] ?? [])]);
  const toks = pool.map((p) => words(p.c));
  const df = new Map<string, number>();
  toks.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const avg = toks.reduce((n, t) => n + t.length, 0) / pool.length || 1;
  const scored = pool.map((p, i) => {
    const tf = new Map<string, number>();
    toks[i].forEach((w) => tf.set(w, (tf.get(w) ?? 0) + 1));
    let s = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const d = df.get(w) ?? 0;
      s += (Math.log(1 + (pool.length - d + 0.5) / (d + 0.5)) * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (toks[i].length / avg)));
    }
    return { ...p, s };
  });
  const best = scored.filter((x) => x.s > 0 && !x.head).sort((a, b) => b.s - a.s).slice(0, k);
  return [...scored.filter((x) => x.head).map((x) => x.c), ...best.map((x) => x.c)];
}

export function systemPrompt(long: boolean, passages: string[]): string {
  return (
    'You are a real-time copilot helping the user answer a question that was just asked to them. ' +
    'Reply in the first person, exactly as the user would say it out loud. Lead with the answer: no preamble, never restate the question. ' +
    (long ? 'Be thorough but tight (about 120 words).' : 'Keep it to 2-4 sentences unless it is a coding or system-design question.') +
    ' For behavioral questions use the STAR shape in one compact paragraph. For code, give the code first, then one line on complexity. ' +
    (passages.length
      ? "Use the user's real experience from the notes below; never invent employers, dates or numbers that are not there.\n\n## About the user\n" + passages.join('\n---\n')
      : "The user has not shared a CV or notes, so do NOT invent a personal history: no made-up employers, tools, years or numbers. Give a strong general answer they can make their own, and put any personal detail in [square brackets] for them to fill in.")
  );
}
