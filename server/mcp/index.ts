import readline from 'node:readline';
import { createDefaultMcpContext, handleMcpRequest, type JsonRpcRequest } from './handler';

/** stdio 传输：stdout 只输出 JSON-RPC，日志一律走 stderr，避免污染协议 */
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const ctx = createDefaultMcpContext();

process.stderr.write('LexGuard MCP Server 已启动（stdio）\n');

rl.on('line', async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
    return;
  }
  try {
    const res = await handleMcpRequest(req, ctx);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
      })}\n`,
    );
  }
});
