import type { CitationStatus } from '../core/schema';

/**
 * B5 评测集与指标。
 *
 * 构造规则：正例取自本地演示语料中确实存在的条目；负例按 A3 六类幻觉人工注入；
 * 固定内容、固定顺序、不随机，保证任何机器、任何时间跑出同一结果。
 *
 * ⚠️ 口径边界：本评测集里的「正例」命中演示语料，期望状态是 demo_only，
 * 不是 verified。只有接入已授权权威数据源并带原文链接时，正例才应变为 verified。
 * 因此这套集子验证的是「核验引擎的状态判定逻辑」，不是「法域准确率」。
 */

export interface LabeledSample {
  id: string;
  text: string;
  expectedStatus: CitationStatus;
  category: string;
  note: string;
}

export const CITATION_EVAL_SET: LabeledSample[] = [
  {
    id: 'NEG-01',
    text: '依据《中华人民共和国民法典》第9999条，甲方有权解除合同。',
    expectedStatus: 'not_in_corpus',
    category: '编造条号',
    note: '条号在库中不存在，必须拦截',
  },
  {
    id: 'NEG-02',
    text: '依据《中华人民共和国合同法》第52条，本合同无效。',
    expectedStatus: 'repealed',
    category: '已废止法条',
    note: '《民法典》2021-01-01 施行后《合同法》废止，必须拦截',
  },
  {
    id: 'NEG-03',
    text: '参见（2024）京01民初99999号民事判决书的裁判要旨。',
    expectedStatus: 'not_in_corpus',
    category: '虚构案号',
    note: '案号在案例库中不存在，必须拦截',
  },
  {
    id: 'NEG-04',
    text: '参见 DEMO-CASE-2024-001，该案认定违约金一律不得调整。',
    expectedStatus: 'demo_only',
    category: '演示案号 / 张冠李戴',
    note: '案号存在但属演示数据；结构化核验不判断要旨是否匹配，须回权威原文人工核对',
  },
  {
    id: 'NEG-05',
    text: '依据《中华人民共和国民法典》第496条第九款，格式条款一律无效。',
    expectedStatus: 'needs_human',
    category: '款项定位',
    note: '条号命中但含款项，结构化核验不裁决款项是否存在，转人工',
  },
  {
    id: 'NEG-06',
    text: '依据《民法典》第条的规定处理。',
    expectedStatus: 'malformed',
    category: '格式异常',
    note: '残缺引用不得静默丢弃，必须显式标 malformed',
  },
  {
    id: 'POS-01',
    text: '依据《中华人民共和国民法典》第496条，格式条款提供方应尽提示说明义务。',
    expectedStatus: 'demo_only',
    category: '现行有效正例（演示语料）',
    note: '条号存在且现行有效；因数据源是演示语料，只能标 demo_only',
  },
  {
    id: 'POS-02',
    text: '依据《中华人民共和国劳动合同法》第82条，未订立书面劳动合同应支付二倍工资。',
    expectedStatus: 'demo_only',
    category: '现行有效正例（演示语料）',
    note: '同上；接权威库后应变为 verified',
  },
];

export interface StatusMetrics {
  status: CitationStatus;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export interface EvalResult {
  samples: number;
  accuracy: number;
  perStatus: StatusMetrics[];
}

/**
 * 定义：按状态分类的精确率 / 召回率与整体状态判对率。
 * 公式：precision = TP/(TP+FP)，recall = TP/(TP+FN)，accuracy = 判对数/样本数。
 * 边界：每个样本只取「主状态」（第一条引用的状态）；分母为 0 时指标记 0。
 * 局限：构造负例 ≠ 真实幻觉分布；演示语料 ≠ 权威库；结果只反映引擎逻辑，
 *       不得对外表述为「法律问答准确率」或「幻觉率」。
 */
export function evaluateStatuses(
  predicted: CitationStatus[],
  expected: CitationStatus[],
): EvalResult {
  const n = Math.min(predicted.length, expected.length);
  const statuses = Array.from(new Set([...predicted, ...expected])) as CitationStatus[];
  const perStatus: StatusMetrics[] = statuses.map((status) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < n; i += 1) {
      const p = predicted[i] === status;
      const e = expected[i] === status;
      if (p && e) tp += 1;
      else if (p && !e) fp += 1;
      else if (!p && e) fn += 1;
    }
    return {
      status,
      tp,
      fp,
      fn,
      precision: tp + fp === 0 ? 0 : tp / (tp + fp),
      recall: tp + fn === 0 ? 0 : tp / (tp + fn),
    };
  });
  let correct = 0;
  for (let i = 0; i < n; i += 1) if (predicted[i] === expected[i]) correct += 1;
  return { samples: n, accuracy: n === 0 ? 0 : correct / n, perStatus };
}
