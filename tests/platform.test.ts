import { describe, expect, it } from 'vitest';
import { SkillRegistry, SkillVersionError } from '../server/core/skills';
import { FactError, FactStore } from '../server/core/facts';
import { TenancyGuard, PermissionError, demoTenancy } from '../server/core/tenancy';
import { UsageMeter } from '../server/core/usage';
import { LocalFixtureProvider, ManagedDataSource } from '../server/providers/datasource';
import type { CompanyRecord, LawArticle, LawDataSource, LegalCase } from '../server/core/schema';

class BrokenSource implements LawDataSource {
  readonly name = 'BROKEN-REMOTE';
  readonly demo = false;
  async searchLaws(): Promise<LawArticle[]> { throw new Error('服务不可用'); }
  async getLaw(): Promise<LawArticle | undefined> { throw new Error('服务不可用'); }
  async searchCases(): Promise<LegalCase[]> { throw new Error('服务不可用'); }
  async getCase(): Promise<LegalCase | undefined> { throw new Error('服务不可用'); }
  async searchCompany(): Promise<CompanyRecord[]> { throw new Error('服务不可用'); }
  async allLaws(): Promise<LawArticle[]> { throw new Error('服务不可用'); }
  async allCases(): Promise<LegalCase[]> { throw new Error('服务不可用'); }
}

describe('C4 Skill 中心', () => {
  it('内置三份清单且版本化', () => {
    const r = new SkillRegistry();
    expect(r.list()).toHaveLength(3);
    expect(r.get('contract-review')?.version).toBe('1.0.0');
  });

  it('同版本重复注册被拒绝，必须升版本', () => {
    const r = new SkillRegistry();
    const s = r.get('contract-review')!;
    expect(() => r.register({ ...s, version: '1.0.0' })).toThrow(SkillVersionError);
    expect(r.register({ ...s, version: '1.1.0' }).version).toBe('1.1.0');
  });

  it('必填项未确认时不算完成，并列出缺口', () => {
    const r = new SkillRegistry();
    const partial = r.runChecklist('contract-review', ['c1', 'c2']);
    expect(partial.complete).toBe(false);
    expect(partial.missing.length).toBeGreaterThan(0);
    const all = r.get('contract-review')!.checklist.filter((i) => i.required).map((i) => i.id);
    expect(r.runChecklist('contract-review', all).complete).toBe(true);
  });

  it('导入导出保持版本不冲突', () => {
    const a = new SkillRegistry();
    const b = new SkillRegistry(false);
    expect(b.importFrom(a.exportAll())).toEqual({ added: 3, skipped: 0 });
    expect(b.importFrom(a.exportAll()).skipped).toBe(3);
  });
});

describe('C5 案件事实层', () => {
  it('无出处的事实一律拒绝写入', () => {
    const f = new FactStore();
    expect(() => f.add({ subject: '甲公司', predicate: '注册资本', value: '1000万', source: '', demo: true, verified: false })).toThrow(FactError);
  });

  it('矛盾显式暴露，不自动合并', () => {
    const f = new FactStore();
    f.add({ subject: '甲公司', predicate: '注册资本', value: '1000万', source: '工商', demo: true, verified: false });
    f.add({ subject: '甲公司', predicate: '注册资本', value: '1200万', source: '访谈', demo: true, verified: false });
    const c = f.contradictions();
    expect(c).toHaveLength(1);
    expect(c[0].values).toEqual(['1000万', '1200万']);
    expect(f.size()).toBe(2);
  });

  it('显式暴露「应存在但缺失」的事实', () => {
    const f = new FactStore();
    f.add({ subject: '甲公司', predicate: '注册资本', value: '1000万', source: '工商', demo: true, verified: false });
    expect(f.missing('甲公司', ['注册资本', '涉诉记录', '知识产权'])).toEqual(['涉诉记录', '知识产权']);
  });
});

describe('E1 多租户与伦理墙', () => {
  it('角色权限矩阵生效', () => {
    const g = demoTenancy();
    expect(g.can('王助理', 'tenant-demo', 'read', 'matter-b')).toBe(true);
    expect(g.can('王助理', 'tenant-demo', 'export')).toBe(false);
    expect(g.can('张律师', 'tenant-demo', 'manage')).toBe(true);
  });

  it('被排除的项目不会出现在列表中', () => {
    const g = demoTenancy();
    expect(g.listMatters('李律师', 'tenant-demo').map((m) => m.id)).toEqual(['matter-a']);
    expect(g.listMatters('王助理', 'tenant-demo').map((m) => m.id)).toEqual(['matter-b']);
    expect(() => g.assert('李律师', 'tenant-demo', 'read', 'matter-b')).toThrow(PermissionError);
  });

  it('空租户可正常注册与查询', () => {
    const g = new TenancyGuard();
    g.addTenant({ id: 't1', name: '测试', members: [], matters: [] });
    expect(g.list()).toHaveLength(1);
    expect(g.listMatters('u', 't1')).toEqual([]);
  });
});

describe('E3 用量计量', () => {
  it('按字符数/4 估算并明确标注非计费口径', () => {
    const m = new UsageMeter();
    expect(m.recordLLM('s1', '张律师', 100)).toBe(25);
    m.recordTool('s1', '张律师', 'verify_citations');
    m.recordLLM('s2', '李律师', 40);
    const s = m.summary();
    expect(s.sessions).toBe(2);
    expect(s.llmCalls).toBe(2);
    expect(s.toolCalls).toBe(1);
    expect(s.tokensEstimate).toBe(35);
    expect(s.note).toContain('非厂商计费口径');
    expect(m.bySession('s1')).toHaveLength(2);
  });
});

describe('E2 数据源健康检查与降级', () => {
  it('主源失败时自动降级，且 demo 变为 true', async () => {
    const ds = new ManagedDataSource(new BrokenSource(), new LocalFixtureProvider());
    expect(ds.demo).toBe(false);
    const laws = await ds.allLaws();
    expect(laws.length).toBeGreaterThan(0);
    expect(ds.isDegraded).toBe(true);
    expect(ds.demo).toBe(true);
    expect(ds.name).toContain('已降级');
  });

  it('health 报告降级原因与当前生效源', async () => {
    const ds = new ManagedDataSource(new BrokenSource(), new LocalFixtureProvider());
    const h = await ds.health();
    expect(h.ok).toBe(false);
    expect(h.degraded).toBe(true);
    expect(h.active).toBe('DEMO-LOCAL-FIXTURE');
    expect(h.detail).toContain('服务不可用');
  });

  it('主源正常时不降级', async () => {
    const ds = new ManagedDataSource(new LocalFixtureProvider(), new LocalFixtureProvider());
    const h = await ds.health();
    expect(h.ok).toBe(true);
    expect(ds.isDegraded).toBe(false);
  });
});
