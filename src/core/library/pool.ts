import { shuffle } from '../infra/util';
import type { Question } from '../model/types';

export function selectRunQuestions(
  all: Question[], topics: string[], isRetired: (question: Question) => boolean, quota: number,
): Question[] {
  const selected: Question[] = [];
  for (const topic of topics) {
    const mine = all.filter((question) => question.topic === topic);
    const live = mine.filter((question) => !isRetired(question));
    selected.push(...shuffle(live.length ? live : mine).slice(0, quota));
  }
  return selected;
}
