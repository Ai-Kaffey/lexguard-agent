/**
 * C5 全局记忆 / 案件事实层。
 *
 * 设计约束：
 * 1. 每条事实必须带出处，无出处一律拒绝写入。
 * 2. 矛盾与「应存在但缺失」是显式一等输出，而不是让模型自己脑补。
 * 3. 事实层只记录「已确认的事实」，不负责判断法律结论。
 */

export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  source: string;
  demo: boolean;
  verified: boolean;
  addedAt: string;
}

export type FactInput = Omit<Fact, 'id' | 'addedAt'>;

export interface Contradiction {
  subject: string;
  predicate: string;
  values: string[];
  sources: string[];
}

export class FactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactError';
  }
}

export class FactStore {
  private facts: Fact[] = [];
  private seq = 0;

  add(input: FactInput): Fact {
    if (!input.source.trim()) throw new FactError('事实必须带出处，禁止写入无来源的断言');
    if (!input.subject.trim() || !input.predicate.trim() || !input.value.trim()) {
      throw new FactError('subject / predicate / value 不能为空');
    }
    const fact: Fact = {
      ...input,
      id: `fact-${++this.seq}`,
      addedAt: new Date().toISOString(),
    };
    this.facts.push(fact);
    return fact;
  }

  list(subject?: string): Fact[] {
    return subject ? this.facts.filter((f) => f.subject === subject) : [...this.facts];
  }

  size(): number {
    return this.facts.length;
  }

  /** 同一主体 + 同一属性出现不同取值 = 冲突，挂起不自动合并、不投票、不让模型裁决 */
  contradictions(): Contradiction[] {
    const groups = new Map<string, Fact[]>();
    for (const f of this.facts) {
      const k = `${f.subject}::${f.predicate}`;
      const arr = groups.get(k) ?? [];
      arr.push(f);
      groups.set(k, arr);
    }
    const out: Contradiction[] = [];
    for (const [k, arr] of groups) {
      const values = [...new Set(arr.map((f) => f.value))];
      if (values.length > 1) {
        const [subject, predicate] = k.split('::');
        out.push({
          subject,
          predicate,
          values,
          sources: [...new Set(arr.map((f) => f.source))],
        });
      }
    }
    return out;
  }

  /** 按清单检查某主体「应存在但缺失」的事实，显式暴露缺口 */
  missing(subject: string, requiredPredicates: string[]): string[] {
    const present = new Set(this.list(subject).map((f) => f.predicate));
    return requiredPredicates.filter((p) => !present.has(p));
  }

  toJsonl(): string {
    return this.facts.map((f) => JSON.stringify(f)).join('\n');
  }
}
