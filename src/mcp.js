import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBoardMcp } from './board-mcp.js';

const origin = new URL(process.env.MCP_BOARD_ORIGIN || 'http://127.0.0.1:4173').origin;
const token = process.env.MCP_TOKEN;
if (!token || token.length < 32) throw new Error('Set MCP_TOKEN to the token issued in the whiteboard’s local stdio settings.');
async function board(method = 'GET', payload, suffix = '') {
  const response = await fetch(origin + '/api/mcp/current' + suffix, {
    method,
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload && JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

const server = createBoardMcp({ board, origin });
await server.connect(new StdioServerTransport());
