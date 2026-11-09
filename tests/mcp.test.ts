import { describe, expect, it } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  createDefaultMcpContext,
  handleMcpRequest,
  mcpToolList,
  type JsonRpcRequest,
} from '../server/mcp/handler';

const ctx = createDefaultMcpContext();
const req = (method: string, params?: Record<string, unknown>, id: number | string | null = 1): JsonRpcRequest => ({
  jsonrpc: '2.0', id, method, ...(params ? { params } : {}),
});

describe('D4 MCP Server', () => {
  it('initialize 返回协议版本与能力声明', async () => {
    const res = await handleMcpRequest(req('initialize'), ctx);
    expect(res?.jsonrpc).toBe('2.0');
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it('tools/list 暴露六个法律工具且 inputSchema 完整', () => {
    const tools = mcpToolList();
    expect(tools).toHaveLength(6);
    expect(tools.every((t) => t.inputSchema && t.description)).toBe(true);
    expect(tools.map((t) => t.name)).toContain('verify_citations');
  });

  it('tools/call 能实际执行引用核验', async () => {
    const res = await handleMcpRequest(
      req('tools/call', { name: 'verify_citations', arguments: { text: '依据《中华人民共和国合同法》第52条。' } }),
      ctx,
    );
    const text = (res?.result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain('repealed');
  });

  it('通知（无 id）不回复，符合 JSON-RPC 约定', async () => {
    expect(await handleMcpRequest(req('notifications/initialized', undefined, null), ctx)).toBeNull();
  });

  it('未知方法返回 -32601', async () => {
    const res = await handleMcpRequest(req('no/such/method'), ctx);
    expect(res?.error?.code).toBe(-32601);
  });
});
