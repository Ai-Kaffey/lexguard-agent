export type DataClass = 'A' | 'B' | 'C';

export type CitationStatus =
  | 'verified'
  | 'repealed'
  | 'not_in_corpus'
  | 'demo_only'
  | 'malformed'
  | 'needs_human';

export type RiskLevel = 'high' | 'medium' | 'low';

export type ReviewState =
  | 'draft'
  | 'verification'
  | 'pending_review'
  | 'approved'
  | 'exported';

export interface LawArticle {
  id: string;
  law: string;
  articleNo: number;
  article: string;
  gist: string;
  level: string;
  validity: '现行有效' | '已废止';
  effectiveNote?: string;
  source: string;
  sourceUrl?: string;
  demo: boolean;
  tags: string[];
}

export interface LegalCase {
  id: string;
  caseNo: string;
  title: string;
  court: string;
  date: string;
  gist: string;
  keywords: string[];
  demo: boolean;
  sourceUrl?: string;
}

export interface CompanyRecord {
  id: string;
  name: string;
  creditCode: string;
  established: string;
  status: string;
  litigation: { count: number; summary: string }[];
  demo: boolean;
}

export interface RawCitation {
  raw: string;
  kind: 'law' | 'case' | 'company' | 'unknown';
  law?: string;
  articleNo?: number;
  paragraph?: string;
  caseNo?: string;
}

export interface CitationMatch {
  law: string;
  article: string;
  gist: string;
  validity: string;
  level: string;
  source: string;
  sourceUrl?: string;
  demo: boolean;
}

export interface Citation extends RawCitation {
  status: CitationStatus;
  reason: string;
  matched?: CitationMatch;
}

export interface ContractRisk {
  id: string;
  level: RiskLevel;
  category: string;
  quote: string;
  reason: string;
  basis: string[];
  suggestion: string;
}

export interface ReviewRecord {
  citationRaw: string;
  reviewer: string;
  decision: 'approved' | 'rejected' | 'edited';
  note?: string;
  at: string;
}

export interface AuditEvent {
  ts: string;
  who: string;
  agent?: string;
  tool?: string;
  dataClass: DataClass;
  action: string;
  source?: string;
  citation?: string;
  verification?: string;
  reviewer?: string;
  exported?: boolean;
  detail?: string;
}

export interface Declaration {
  toolName: string;
  usedIn: string[];
  reviewedBy: string;
  generatedAt: string;
  items: { citation: string; status: string }[];
  reviewRecords: { key: string; decision: string; reviewer: string; at: string }[];
  statement: string;
}

export interface LawDataSource {
  readonly name: string;
  readonly demo: boolean;
  searchLaws(query: string): Promise<LawArticle[]>;
  getLaw(law: string, articleNo: number): Promise<LawArticle | undefined>;
  searchCases(query: string): Promise<LegalCase[]>;
  getCase(caseNo: string): Promise<LegalCase | undefined>;
  searchCompany(name: string): Promise<CompanyRecord[]>;
  allLaws(): Promise<LawArticle[]>;
  allCases(): Promise<LegalCase[]>;
}
