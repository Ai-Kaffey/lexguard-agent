export type CitationStatus =
  | 'verified'
  | 'repealed'
  | 'not_in_corpus'
  | 'demo_only'
  | 'malformed'
  | 'needs_human';

export interface Citation {
  raw: string;
  kind: 'law' | 'case' | 'company' | 'unknown';
  status: CitationStatus;
  reason: string;
  law?: string;
  articleNo?: number;
  caseNo?: string;
  matched?: {
    law: string;
    article: string;
    gist: string;
    validity: string;
    level: string;
    source: string;
    sourceUrl?: string;
    demo: boolean;
  };
}

export interface ContractRisk {
  id: string;
  level: 'high' | 'medium' | 'low';
  category: string;
  quote: string;
  reason: string;
  basis: string[];
  suggestion: string;
}

export interface Health {
  name: string;
  disclaimer: string;
  llm: { provider: string; model: string; isLocal: boolean };
  datasource: {
    name: string;
    demo: boolean;
    stats: { laws: number; cases: number; companies: number; repealed: number; allDemo: boolean };
  };
  ruleCount: number;
  auditEvents: number;
}

export interface ToolView {
  id: string;
  name: string;
  args: string;
  result?: string;
  risks?: ContractRisk[];
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ToolView[];
}

export interface ExportBundle {
  riskReport: string;
  verificationDetail: string;
  reviewLog: string;
  declaration: string;
}

export type SSEEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name: string; result: string; risks?: ContractRisk[] }
  | { type: 'verification'; citations: Citation[] }
  | { type: 'review_required'; message: string }
  | { type: 'done'; content: string; citations: Citation[]; dataClass: 'A' | 'B' | 'C' }
  | { type: 'error'; message: string };
