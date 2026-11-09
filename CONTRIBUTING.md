# 贡献指南

## 原则

1. **任何新能力都必须穿过治理层**：生成后强制走引用核验，导出前强制人工复核闸门，外部模型调用前强制数据分级路由。不要加「绕过核验」的快捷开关。
2. **不编造权威数据**：新增演示语料必须 `demo: true`，案号用 `DEMO-CASE-YYYY-NNN`，法条只写编号 + 效力 + 主旨摘要，不冒充官方全文。
3. **不发布未经验证的准确率**：所有指标写清定义 / 公式 / 边界 / 局限；没有权威库标注集就不写百分比。
4. **密钥不入库**：`.env` 已被忽略，测试与 CI 必须能在零密钥下跑通。

## 本地流程

```bash
npm install
npm run check   # typecheck + test + build
npm run dev
```

新增功能请同时补 `tests/` 下的单测，并更新 README「已实现 / 未实现」表格与 ROADMAP.md 的期数状态。

## 代码位置

| 需求 | 改哪里 |
|---|---|
| 新增核验规则 / 状态 | `server/core/citations.ts` |
| 新增合同风险规则 | `server/core/contract.ts` 的 `RISK_RULES` |
| 新增 Agent 工具 | `server/agent/tools.ts` 的 `TOOL_DEFINITIONS` 与 `dispatchTool` |
| 接新的法律数据源 | 实现 `LawDataSource` 接口（`server/core/schema.ts`），降级逻辑在 `providers/datasource.ts` |
| 新增 Skill / 事实 / 权限 / 用量规则 | `server/core/skills.ts` / `facts.ts` / `tenancy.ts` / `usage.ts` |
| 新增 MCP 工具 | `server/agent/tools.ts` + `server/mcp/handler.ts` |
| 新增前端面板 | `src/components/` |
