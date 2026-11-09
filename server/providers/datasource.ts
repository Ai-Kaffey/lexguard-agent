import { CASES, COMPANIES, FIXTURE_STATS, LAWS } from '../core/fixtures';
import type {
  CompanyRecord,
  LawArticle,
  LawDataSource,
  LegalCase,
} from '../core/schema';

/**
 * 可插拔法律数据源。生产环境应接北大法宝 / 企查查等已授权 MCP 或 HTTP 服务；
 * 本平台不复制、不缓存权威库全文，只存标识、出处链接与时效元数据。
 */

export class LocalFixtureProvider implements LawDataSource {
  readonly name = 'DEMO-LOCAL-FIXTURE';
  readonly demo = true;

  async searchLaws(query: string): Promise<LawArticle[]> {
    const q = query.trim();
    if (!q) return [...LAWS];
    return LAWS.filter(
      (l) =>
        l.law.includes(q) ||
        l.gist.includes(q) ||
        l.article.includes(q) ||
        l.tags.some((t) => t.includes(q)),
    );
  }

  async getLaw(law: string, articleNo: number): Promise<LawArticle | undefined> {
    return LAWS.find((l) => l.law === law && l.articleNo === articleNo);
  }

  async searchCases(query: string): Promise<LegalCase[]> {
    const q = query.trim();
    if (!q) return [...CASES];
    return CASES.filter(
      (c) =>
        c.title.includes(q) ||
        c.gist.includes(q) ||
        c.caseNo.includes(q) ||
        c.keywords.some((k) => k.includes(q)),
    );
  }

  async getCase(caseNo: string): Promise<LegalCase | undefined> {
    return CASES.find((c) => c.caseNo === caseNo);
  }

  async searchCompany(name: string): Promise<CompanyRecord[]> {
    const q = name.trim();
    return COMPANIES.filter((c) => !q || c.name.includes(q) || c.creditCode.includes(q));
  }

  async allLaws(): Promise<LawArticle[]> {
    return [...LAWS];
  }

  async allCases(): Promise<LegalCase[]> {
    return [...CASES];
  }
}

/** 通用远端数据源。约定 REST 契约，可由北大法宝 / 企查查 MCP 网关适配后实现。 */
export class HttpLawDataSource implements LawDataSource {
  readonly name: string;
  readonly demo = false;

  constructor(
    private readonly baseUrl: string,
    private readonly token = '',
  ) {
    this.name = `HTTP:${baseUrl}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!res.ok) throw new Error(`数据源请求失败：${res.status} ${path}`);
    return (await res.json()) as T;
  }

  async searchLaws(query: string): Promise<LawArticle[]> {
    return this.get<LawArticle[]>(`/laws?q=${encodeURIComponent(query)}`);
  }
  async getLaw(law: string, articleNo: number): Promise<LawArticle | undefined> {
    return this.get<LawArticle | undefined>(
      `/laws/${encodeURIComponent(law)}/${articleNo}`,
    );
  }
  async searchCases(query: string): Promise<LegalCase[]> {
    return this.get<LegalCase[]>(`/cases?q=${encodeURIComponent(query)}`);
  }
  async getCase(caseNo: string): Promise<LegalCase | undefined> {
    return this.get<LegalCase | undefined>(`/cases/${encodeURIComponent(caseNo)}`);
  }
  async searchCompany(name: string): Promise<CompanyRecord[]> {
    return this.get<CompanyRecord[]>(`/companies?q=${encodeURIComponent(name)}`);
  }
  async allLaws(): Promise<LawArticle[]> {
    return this.searchLaws('');
  }
  async allCases(): Promise<LegalCase[]> {
    return this.searchCases('');
  }
}

export interface DataSourceConfig {
  mode: 'local' | 'http';
  url?: string;
  token?: string;
}

export function createDataSource(config: DataSourceConfig = { mode: 'local' }): LawDataSource {
  if (config.mode === 'http' && config.url) {
    return new HttpLawDataSource(config.url, config.token);
  }
  return new LocalFixtureProvider();
}

export { FIXTURE_STATS };
