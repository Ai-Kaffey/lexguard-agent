import { dispatchTool, TOOL_DEFINITIONS, type ToolContext } from '../agent/tools';
import { createDataSource } from '../providers/datasource';

/**
 * D4 MCP Server（零依赖 stdio JSON-RPC 实现）。
 * 把引用核验、检索、合同审查等能力暴露为标准工具，
 * 供 Claude、WorkBuddy 等宿主直接调用，无需重复实现。
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_INFO = { name: 'lexguard', version: '0.1.0' };

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export function mcpToolList() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  }));
}

export function createDefaultMcpContext(): ToolContext {
  return { ds: createDataSource({ mode: 'local' }) };
}

/** 返回 null 表示这是通知（无 id），协议规定不应回复 */
export async function handleMcpRequest(
  req: JsonRpcRequest,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  if (req.id === undefined || req.id === null) return null;
  const base = { jsonrpc: '2.0' as const, id: req.id };

  switch (req.method) {
    case 'initialize':
      return {
        ...base,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: MCP_SERVER_INFO,
        },
      };
    case 'ping':
      return { ...base, result: {} };
    case 'tools/list':
      return { ...base, result: { tools: mcpToolList() } };
    case 'tools/call': {
      const params = req.params ?? {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args = params.arguments ?? {};
      const out = await dispatchTool(name, JSON.stringify(args), ctx);
      return {
        ...base,
        result: { content: [{ type: 'text', text: out.result }], isError: false },
      };
    }
    default:
      return { ...base, error: { code: -32601, message: `未知方法：${req.method}` } };
  }
}
