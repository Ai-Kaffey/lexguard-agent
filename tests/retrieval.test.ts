import { describe, expect, it } from 'vitest';
import { bm25Search, buildRagContext, tokenize, type RagDoc } from '../server/core/retrieval';
import { LocalFixtureProvider } from '../server/providers/datasource';

const docs: RagDoc[] = [
  { id: 'A', text: '格式条款提供方应尽提示说明义务', source: 'S1', demo: true },
  { id: 'B', text: '违约金过分高于损失可以请求调整', source: 'S2', demo: true },
  { id: 'C', text: '未订立书面劳动合同应支付二倍工资', source: 'S3', demo: true },
];

describe('B3 BM25 检索', () => {
  it('中文按字切分，英文数字成词', () => {
    expect(tokenize('民法典496条')).toEqual(['民', '法', '典', '496', '条']);
  });

  it('相关文档排在首位', () => {
    const hits = bm25Search('格式条款提示义务', docs, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].doc.id).toBe('A');
  });

  it('检索上下文带出处与演示标注', async () => {
    const ds = new LocalFixtureProvider();
    const { hits, context } = await buildRagContext('格式条款', ds, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(context).toContain('来源：');
    expect(context).toContain('演示语料');
  });
});
