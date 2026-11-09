/**
 * C4 Skill 中心：把审查清单与交付步骤做成版本化、可导入导出的组织资产。
 * 版本化是关键：改了清单不能悄悄影响历史案件，必须显式升版本。
 */

export interface SkillCheckItem {
  id: string;
  label: string;
  required: boolean;
}

export interface Skill {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  checklist: SkillCheckItem[];
  steps: string[];
  demo: boolean;
  createdAt: string;
}

export type SkillInput = Omit<Skill, 'createdAt'>;

export class SkillVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillVersionError';
  }
}

const key = (id: string, version: string) => `${id}@${version}`;

function seedSkills(): Skill[] {
  const now = '2026-11-09T00:00:00.000Z';
  return [
    {
      id: 'contract-review',
      name: '合同审查标准清单',
      version: '1.0.0',
      category: '合同',
      description: '初审一份商事合同时必须逐项确认的要点',
      checklist: [
        { id: 'c1', label: '主体全称与统一社会信用代码已核对', required: true },
        { id: 'c2', label: '签署人授权文件已取得', required: true },
        { id: 'c3', label: '标的、数量、价款与付款节点明确', required: true },
        { id: 'c4', label: '验收标准可客观检验', required: true },
        { id: 'c5', label: '违约责任与救济路径完整', required: true },
        { id: 'c6', label: '格式条款已尽提示说明义务', required: true },
        { id: 'c7', label: '争议解决条款双方对等', required: true },
        { id: 'c8', label: '保密与知识产权条款边界清晰', required: false },
      ],
      steps: ['读取全文并分级', '规则引擎初筛', '依据法条逐条核验', '人工逐条复核签字', '导出四件套'],
      demo: true,
      createdAt: now,
    },
    {
      id: 'legal-opinion',
      name: '法律意见书交付清单',
      version: '1.0.0',
      category: '文书',
      description: '对外出具法律意见书前的强制复核节点',
      checklist: [
        { id: 'o1', label: '事实材料均有原始出处', required: true },
        { id: 'o2', label: '全部法条引用已回权威库全文比对', required: true },
        { id: 'o3', label: '案例引用已核对案号、法院、日期与要旨', required: true },
        { id: 'o4', label: '已标注 AI 辅助生成', required: true },
        { id: 'o5', label: '承办人员逐条实质审核并签字', required: true },
        { id: 'o6', label: '《AI 使用声明》随附', required: true },
      ],
      steps: ['事实归集', '检索与引用核验', '起草', '双人复核', '签字出具'],
      demo: true,
      createdAt: now,
    },
    {
      id: 'due-diligence',
      name: '并购尽调资料清单',
      version: '1.0.0',
      category: '尽调',
      description: '目标公司资料收集与缺口识别',
      checklist: [
        { id: 'd1', label: '工商登记与股权结构', required: true },
        { id: 'd2', label: '重大合同清单', required: true },
        { id: 'd3', label: '涉诉与行政处罚', required: true },
        { id: 'd4', label: '知识产权权属', required: true },
        { id: 'd5', label: '劳动用工与社保', required: true },
        { id: 'd6', label: '财务报表与或有负债', required: true },
        { id: 'd7', label: '环保与行业资质', required: false },
      ],
      steps: ['发出资料清单', '接收与编号', '缺口识别', '风险分级', '出具尽调报告'],
      demo: true,
      createdAt: now,
    },
  ];
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  constructor(seed = true) {
    if (seed) for (const s of seedSkills()) this.skills.set(key(s.id, s.version), s);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  get(id: string, version?: string): Skill | undefined {
    if (version) return this.skills.get(key(id, version));
    const versions = this.list().filter((s) => s.id === id).sort((a, b) => b.version.localeCompare(a.version));
    return versions[0];
  }

  register(input: SkillInput): Skill {
    const k = key(input.id, input.version);
    if (this.skills.has(k)) {
      throw new SkillVersionError(`版本 ${k} 已存在；修改清单请升级版本号，不要覆盖历史版本`);
    }
    if (input.checklist.length === 0) throw new Error('清单不能为空');
    const skill: Skill = { ...input, createdAt: new Date().toISOString() };
    this.skills.set(k, skill);
    return skill;
  }

  /** 逐项确认：required 项缺一即不算完成 */
  runChecklist(id: string, answeredIds: string[], version?: string): {
    complete: boolean;
    missing: string[];
    answered: number;
    total: number;
  } {
    const skill = this.get(id, version);
    if (!skill) return { complete: false, missing: [], answered: 0, total: 0 };
    const answered = new Set(answeredIds);
    const missing = skill.checklist.filter((i) => i.required && !answered.has(i.id)).map((i) => i.label);
    return {
      complete: missing.length === 0,
      missing,
      answered: skill.checklist.filter((i) => answered.has(i.id)).length,
      total: skill.checklist.length,
    };
  }

  exportAll(): string {
    return JSON.stringify({ format: 'lexguard-skills/v1', exportedAt: new Date().toISOString(), skills: this.list() }, null, 2);
  }

  importFrom(json: string): { added: number; skipped: number } {
    let parsed: { skills?: SkillInput[] };
    try {
      parsed = JSON.parse(json) as { skills?: SkillInput[] };
    } catch {
      throw new Error('导入内容不是合法 JSON');
    }
    if (!Array.isArray(parsed.skills)) throw new Error('缺少 skills 数组');
    let added = 0;
    let skipped = 0;
    for (const s of parsed.skills) {
      if (this.skills.has(key(s.id, s.version))) {
        skipped += 1;
        continue;
      }
      this.register(s);
      added += 1;
    }
    return { added, skipped };
  }
}
