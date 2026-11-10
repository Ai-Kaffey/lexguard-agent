import fs from 'node:fs';
import path from 'node:path';

/**
 * 持久化：append-only JSONL 落盘。
 *
 * 为什么必须有这一层：README / 合规映射表里承诺「审计日志留存不少于 3 年」，
 * 如果所有状态只在内存 Map 里，服务一重启就全部丢失，等于虚假宣称。
 * 这里用单文件追加写，不引入数据库，符合单端口沙箱部署约束。
 *
 * 口径边界：落盘只保证「写入后不丢」，保留期限由部署方的文件生命周期策略决定；
 * 本模块不自动删除、也不自动归档。
 */

export class JsonlStore {
  readonly file: string;

  constructor(dir: string, name: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, name);
  }

  append(record: unknown): void {
    fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  readAll<T>(): T[] {
    if (!fs.existsSync(this.file)) return [];
    const text = fs.readFileSync(this.file, 'utf8');
    const out: T[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // 单行损坏不影响其余记录回放，跳过即可
      }
    }
    return out;
  }

  size(): number {
    return this.readAll<unknown>().length;
  }

  clear(): void {
    if (fs.existsSync(this.file)) fs.writeFileSync(this.file, '', 'utf8');
  }
}

export interface PersistedSession {
  sessionId: string;
  content: string;
  citations: unknown[];
  at: string;
}

export interface PersistedReview {
  sessionId: string;
  key: string;
  reviewer: string;
  decision: string;
  note?: string;
  at: string;
}

export class Persistence {
  readonly dir: string;
  readonly audit: JsonlStore;
  readonly usage: JsonlStore;
  readonly reviews: JsonlStore;
  readonly sessions: JsonlStore;

  constructor(dir: string) {
    this.dir = dir;
    this.audit = new JsonlStore(dir, 'audit.jsonl');
    this.usage = new JsonlStore(dir, 'usage.jsonl');
    this.reviews = new JsonlStore(dir, 'reviews.jsonl');
    this.sessions = new JsonlStore(dir, 'sessions.jsonl');
  }

  stats() {
    return {
      dir: this.dir,
      auditEvents: this.audit.size(),
      usageRecords: this.usage.size(),
      reviewRecords: this.reviews.size(),
      sessionRecords: this.sessions.size(),
      retentionNote: '追加写、不自动删除；保留期限由部署方文件生命周期策略配置',
    };
  }
}
