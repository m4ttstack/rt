import { optionValue } from './options';
import type { GateQuestion } from './types';

const CHUNK_RE = /^(.*)-(\d+)$/;

export function chunkGroupKey(id: string): string | null {
  const m = CHUNK_RE.exec(id);
  return m ? m[1]! : null;
}

export function collapseChunks(questions: GateQuestion[]): {
  questions: GateQuestion[];
  groups: Map<string, string[]>;
} {
  const out: GateQuestion[] = [];
  const groups = new Map<string, string[]>();
  for (const question of questions) {
    const base = question.multi ? chunkGroupKey(question.id) : null;
    if (base === null) {
      out.push(question);
      continue;
    }
    const prior = groups.get(base);
    if (prior && out.length > 0 && out[out.length - 1]!.id === base) {
      const merged = out[out.length - 1]!;
      out[out.length - 1] = {
        ...merged,
        options: [...merged.options, ...question.options],
      };
      prior.push(question.id);
    } else {
      if (groups.has(base))
        throw new Error(`non-adjacent chunks for ${base}: ${question.id}`);
      out.push({ ...question, id: base });
      groups.set(base, [question.id]);
    }
  }
  return { questions: out, groups };
}

export function splitChunkSelections(
  groups: Map<string, string[]>,
  questions: GateQuestion[],
  selections: Record<string, string[]>
): Record<string, string[]> {
  const byId = new Map(questions.map(question => [question.id, question]));
  const out: Record<string, string[]> = {};
  for (const [base, chunkIds] of groups) {
    const picked = new Set(selections[base] ?? []);
    for (const chunkId of chunkIds) {
      const question = byId.get(chunkId);
      if (!question) throw new Error(`unknown chunk question ${chunkId}`);
      out[chunkId] = question.options
        .map(optionValue)
        .filter(value => picked.delete(value));
    }
    if (picked.size > 0)
      throw new Error(
        `selection values outside ${base} chunks: ${[...picked].join(', ')}`
      );
  }
  return out;
}
