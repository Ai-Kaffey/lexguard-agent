import { verifyText } from '../core/citations';
import { countByLevel, reviewContract } from '../core/contract';
import { buildRagContext } from '../core/retrieval';
import type { Citation, ContractRisk, LawDataSource } from '../core/schema';
import type { ToolDefinition } from '../providers/llm';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_laws',
    description: '按关键词检索现行法律法规条文（返回条号、主旨摘要、效力状态与出处）',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '检索关键词或法律问题' } },
      required: ['query'],
    },
  },
  {
    name: 'search_cases',
    description: '检索类案（演示案例编号以 DEMO-CASE 开头，非真实裁判文书）',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '案情或争议焦点' } },
      required: ['query'],
    },
  },
  {
    name: 'verify_citations',
    description: '对一段文本中的法条与案号引用逐条做结构化查库核验，返回六态结果',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '待核验文本' } },
      required: ['text'],
    },
  },
  {
    name: 'review_contract',
    description: '审查合同文本，输出风险条款定位、分级、依据法条与修改建议',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '合同全文或条款片段' } },
      required: ['text'],
    },
  },
  {
    name: 'search_company',
    description: '查询企业主体、工商与涉诉信息（演示数据以 DEMO- 标注）',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '企业名称或统一社会信用代码' } },
      required: ['name'],
    },
  },
  {
    name: 'rag_search',
    description: '在法规与案例语料中做 BM25 检索，返回带出处的片段',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '法律问题' } },
      required: ['query'],
    },
  },
];

export interface ToolContext {
  ds: LawDataSource;
}

export interface ToolResult {
  result: string;
  citations?: Citation[];
  risks?: ContractRisk[];
  hits?: { id: string; source: string; demo: boolean }[];
}

function textArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v : '';
}

export async function dispatchTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return { result: '工具参数不是合法 JSON，已拒绝执行' };
  }

  switch (name) {
    case 'search_laws': {
      const laws = await ctx.ds.searchLaws(textArg(args, 'query'));
      return {
        result: laws.length
          ? laws.map((l) => `${l.law}${l.article}【${l.validity}】${l.gist}（来源：${l.source}${l.demo ? '，演示语料' : ''}）`).join('\n')
          : '未检索到相关条文',
      };
    }
    case 'search_cases': {
      const cases = await ctx.ds.searchCases(textArg(args, 'query'));
      return {
        result: cases.length
          ? cases.map((c) => `${c.caseNo} ${c.title}：${c.gist}`).join('\n')
          : '未检索到相关案例',
      };
    }
    case 'verify_citations': {
      const citations = await verifyText(textArg(args, 'text'), ctx.ds);
      return {
        result: citations.length
          ? citations.map((c) => `${c.raw} → ${c.status}（${c.reason}）`).join('\n')
          : '未检出法条或案例引用',
        citations,
      };
    }
    case 'review_contract': {
      const risks = reviewContract(textArg(args, 'text'));
      const counts = countByLevel(risks);
      const citations = await verifyText(risks.flatMap((r) => r.basis).join('；'), ctx.ds);
      return {
        result:
          `共识别 ${risks.length} 处风险：高 ${counts.high} / 中 ${counts.medium} / 低 ${counts.low}\n` +
          (risks.length
            ? risks.map((r) => `[${r.level}] ${r.category}｜${r.quote}｜依据 ${r.basis.join('、')}｜建议：${r.suggestion}`).join('\n')
            : '未命中演示规则库中的风险模式，不代表合同无风险'),
        risks,
        citations,
      };
    }
    case 'search_company': {
      const rows = await ctx.ds.searchCompany(textArg(args, 'name'));
      return {
        result: rows.length
          ? rows.map((c) => `${c.name}｜${c.creditCode}｜${c.status}｜涉诉 ${c.litigation.reduce((s, l) => s + l.count, 0)} 条${c.demo ? '（演示数据）' : ''}`).join('\n')
          : '未查询到该企业（演示库仅含 2 条模拟记录）',
      };
    }
    case 'rag_search': {
      const { hits, context } = await buildRagContext(textArg(args, 'query'), ctx.ds);
      return {
        result: context || '未检索到相关资料',
        hits: hits.map((h) => ({ id: h.doc.id, source: h.doc.source, demo: h.doc.demo })),
      };
    }
    default:
      return { result: `未知工具：${name}` };
  }
}
