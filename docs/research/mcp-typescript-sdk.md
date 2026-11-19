# MCP TypeScript SDK and local stdio setup

Research for issue #11. Checked on 2026-11-20 against the SDK README and docs site, the MCP spec (2026-07-28), and the Claude Code and Claude Desktop docs. Everything below cites where it came from. Numbers and API shapes change; re-check before building.

## Short version

- The SDK is now v2. The single `@modelcontextprotocol/sdk` package split into `@modelcontextprotocol/server` and `@modelcontextprotocol/client` (plus `core`). v1.x still gets fixes for at least six months after the v2 release on 2026-07-27. Start on v2.
- Tools are registered with `server.registerTool(name, { description, inputSchema, outputSchema?, annotations? }, handler)`. `inputSchema` is a `z.object(...)` (Zod v4, `zod ^4.2.0`). `server.tool()` is gone.
- Structured output works: declare `outputSchema` as a Zod object, return `structuredContent` from the handler. The SDK validates it at runtime and TypeScript checks it at compile time. If you leave `content` out, the SDK sends `JSON.stringify(structuredContent)` as a single text block.
- Serve over stdio with `serveStdio(createServer)` from `@modelcontextprotocol/server/stdio`, where `createServer` is a factory returning a fresh `McpServer`. Never `console.log` in a stdio server; log to stderr.
- Claude Code: `claude mcp add --transport stdio <name> -- node /abs/path/build/index.js`, or a `.mcp.json` at the project root. Claude Desktop: `claude_desktop_config.json` with `mcpServers.<name>.command/args`.
- Claude Code caps MCP tool output at 25,000 tokens by default and writes anything over 50,000 characters to a file instead of the conversation. Shape FPL tools to return small, filtered, structured results, and paginate inside the tool with your own `limit`/`offset` or cursor arguments. The protocol only paginates `tools/list`-style listings, not `tools/call` results.

## SDK state

### Versions

| Package | Latest on npm | Published | Node |
|---|---|---|---|
| `@modelcontextprotocol/server` | 2.4.0 | 2026-10-23 | >=20 |
| `@modelcontextprotocol/client` | 2.4.0 | 2026-10-23 | >=20 |
| `@modelcontextprotocol/sdk` (v1 line) | 1.32.2 | 2026-10-23 | >=18 |
| `zod` | 4.6.7 | 2026-10-12 | |

Source: `npm view` on 2026-11-20. The v1 package still lists `zod: ^3.25 || ^4.0` as a peer dependency; v2 depends on `zod ^4.2.0` and drops Zod 3 ([upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)). Zod 4.0 and 4.1 only work through a fallback that loses `.describe()` text, so pin `zod` at 4.2 or newer.

The README says v2 implements the 2026-07-28 spec and runs on Node, Bun and Deno ([README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md)). Schemas are Standard Schema, so Valibot or ArkType also work, but every official example uses Zod.

### What changed from v1 to v2

From the [upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2):

- One package became three: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/core`. HTTP framework adapters are separate (`/node`, `/express`, `/hono`, `/fastify`). Not relevant for a stdio server.
- `@modelcontextprotocol/sdk/server/stdio.js` became `@modelcontextprotocol/server/stdio`. The package root does not export stdio classes.
- `server.tool()`, `.prompt()` and `.resource()` were removed. Use `registerTool`, `registerPrompt`, `registerResource`.
- `inputSchema` takes a full schema object (`z.object({...})`). Raw shapes like `{ name: z.string() }` still compile through deprecated overloads.
- `registerTool` now type-checks and runtime-validates `structuredContent` against `outputSchema`. Code that typed its result as plain `CallToolResult` can stop compiling.
- Handler second argument renamed from `extra` to `ctx`; `extra.signal` is `ctx.mcpReq.signal`.
- `McpError` became `ProtocolError`, `ErrorCode` became `ProtocolErrorCode`.
- A codemod exists: `npx @modelcontextprotocol/codemod@latest v1-to-v2 .`

Old blog posts and most third-party tutorials still show v1 shapes (`server.tool(name, desc, rawShape, handler)` with `@modelcontextprotocol/sdk`). Treat those as stale.

## Writing a stdio server

### Project setup

From the official [build-server tutorial](https://modelcontextprotocol.io/docs/develop/build-server), TypeScript tab:

```bash
npm install @modelcontextprotocol/server zod
npm install -D @types/node typescript
```

`package.json` needs `"type": "module"`, a `bin` entry and a build script that chmods the output:

```json
{
  "type": "module",
  "bin": { "weather": "./build/index.js" },
  "scripts": {
    "build": "tsc && node -e \"require('fs').chmodSync('build/index.js', '755')\""
  },
  "files": ["build"]
}
```

`tsconfig.json`: `target ES2022`, `module Node16`, `moduleResolution Node16`, `strict`, `outDir ./build`, `rootDir ./src`. Node 20 or newer.

### Minimal server

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

function createServer() {
  const server = new McpServer({ name: "haul", version: "0.1.0" });

  server.registerTool(
    "get_alerts",
    {
      description: "Get weather alerts for a state",
      inputSchema: z.object({
        state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
      }),
    },
    async ({ state }) => ({
      content: [{ type: "text", text: `...` }],
    }),
  );

  return server;
}

serveStdio(createServer, {
  onerror: (error) => console.error("server error:", error),
});
console.error("running on stdio");
```

Why a factory rather than one `server.connect(new StdioServerTransport())`: `serveStdio` negotiates the protocol era with each client. It answers both 2026-07-28 clients (which open with a `server/discover` probe) and 2025-era clients (which open with `initialize`). It may call the factory more than once, including once for a discarded probe instance, so the factory must return a new `McpServer` every time. Hand-wiring `StdioServerTransport` still compiles but only serves 2025-era clients ([build-server tutorial](https://modelcontextprotocol.io/docs/develop/build-server), [stdio serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html), [2026-07-28 support guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)).

`serveStdio` returns a `StdioServerHandle`; call `handle.close()` on `SIGINT`. When the client closes stdin the transport closes on its own. Timers or connection pools must be released in `server.server.onclose` or the process will not exit ([stdio guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)). For an FPL server with a cache refresh timer, that matters.

### Logging

Stdout is the JSON-RPC channel. A single `console.log` corrupts the stream and the client drops the connection. Use `console.error` or a logger that writes to stderr or a file ([build-server tutorial](https://modelcontextprotocol.io/docs/develop/build-server)). Claude Desktop writes each server's stderr to `mcp-server-<name>.log`, so stderr logs are also how you debug.

### Testing without a host

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --protocol-era modern --method tools/list
npx @modelcontextprotocol/inspector --cli node build/index.js --protocol-era legacy --method tools/list
```

The Inspector defaults to the legacy era, so the tutorial says to run both ([build-server tutorial](https://modelcontextprotocol.io/docs/develop/build-server)). Without `--cli` it opens a UI with a Tools tab.

## Tools and schemas

### registerTool config

From the [tools guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) and the [spec](https://modelcontextprotocol.io/specification/latest/server/tools):

| Field | Notes |
|---|---|
| `title` | Display name for UIs. |
| `description` | What the model reads to decide when to call the tool. Keep the first sentence precise; see the Claude Code limits below. |
| `inputSchema` | Zod object. The SDK validates arguments before the handler runs; failures come back as `isError: true` with a message like `Input validation error: Invalid arguments for tool search: limit: Too big: expected number to be <=50`. Omit it for a no-argument tool. |
| `outputSchema` | Optional Zod object. Advertised as JSON Schema in `tools/list`. |
| `annotations` | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Hints only; the SDK ignores them, clients may use them to auto-approve read-only tools. Spec says clients must treat them as untrusted. |

Use `.describe()` on every Zod field. It becomes the JSON Schema `description`, which is the only per-parameter documentation the model sees.

Tool names: 1 to 128 characters, `[A-Za-z0-9_.-]`, unique within the server ([spec](https://modelcontextprotocol.io/specification/latest/server/tools)). Claude Code prefixes names as `mcp__<server>__<tool>` and drops any tool whose full name exceeds 128 characters ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)). Keep server and tool names short.

### Structured output

```ts
server.registerTool(
  "get_product",
  {
    description: "Look up a product",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ name: z.string(), price: z.number() }),
  },
  async ({ id }) => {
    const output = await lookup(id);
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  },
);
```

What the SDK does ([tools guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)):

- TypeScript checks the handler return against `outputSchema`. Missing `structuredContent`, a missing field, or a wrong type is a compile error. `isError: true` results are exempt.
- At runtime it validates `structuredContent` before the result leaves the server.
- You may omit `content`. The server then sends `JSON.stringify(structuredContent)` as one text block. Supply `content` yourself when you want the model to see something other than raw JSON (a compact table, for instance).

The spec says a tool with `structuredContent` SHOULD also return the serialized JSON as text for backwards compatibility, and `outputSchema` may be an array schema, not only an object ([spec](https://modelcontextprotocol.io/specification/latest/server/tools)). The spec also notes that `structuredContent` is server-produced data and is unrelated to LLM structured outputs (schema-constrained generation).

### Errors

Two kinds ([spec](https://modelcontextprotocol.io/specification/latest/server/tools)):

- Protocol errors (unknown tool, malformed request) are JSON-RPC errors. Models rarely recover from these.
- Tool execution errors (API down, bad date, team id not found) go in a normal result with `isError: true` and a text explanation. Clients pass these to the model so it can retry with different arguments. Write the message for the model: say what was wrong and what a valid value looks like.

Claude Code truncates error text longer than about 11,000 characters to the first and last 5,000 ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)).

### Stateful tools

MCP has no protocol-level session a server can lean on. If a tool needs state across calls (a selected team, a draft transfer plan), return an explicit opaque handle from one tool and accept it as an argument on the next ([spec, Stateful Tools](https://modelcontextprotocol.io/specification/latest/server/tools)). For haul, a manager id or league id in each call is simpler than a handle.

## Resources vs tools

The split, from [server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts) and the [resources spec](https://modelcontextprotocol.io/specification/latest/server/resources):

| | Tools | Resources | Prompts |
|---|---|---|---|
| Who decides to use it | Model | Application (host) | User |
| Shape | Function with typed input and output | URI with text or blob contents, optional `ResourceTemplate` with `{params}` | Named template with string arguments |
| In Claude Code | Called by the model, result subject to output limits | `@server:protocol://path` mentions, fuzzy-searchable; Claude Code also adds list/read tools for them | `/server:prompt` slash commands |
| In Claude Desktop | Called by the model with approval | Shown in the connector UI | Shown in the connector UI |

Resources are application-driven: the host decides whether to fetch and include them, and the model cannot call them directly unless the host wraps them in a tool (Claude Code does). Tools are model-controlled. The SDK resources guide puts it as "resources are application-controlled, where tools are model-controlled" ([resources guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/resources.html)).

SDK shape: `server.registerResource(name, uriOrTemplate, metadata, handler)`. `metadata` is required in v2 (can be `{}`). Templates: `new ResourceTemplate("fpl://team/{managerId}", { list: undefined })`, with the matched variables passed to the handler as its second argument. The handler returns `{ contents: [{ uri, mimeType, text }] }` ([resources guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/resources.html)).

Tools can also return `resource_link` content blocks pointing at a URI the client may fetch later, which is one way to hand back a large dataset without putting it in context ([spec](https://modelcontextprotocol.io/specification/latest/server/tools)).

What this means for haul: FPL data that the model should query on demand with parameters (a manager's picks for a gameweek, a league standings page, a player's recent form) belongs in tools. Stable reference data a user might want to pin into context (the current gameweek summary, a glossary of FPL terms, the list of teams) could be a resource, but Claude Desktop and Claude Code expose resources through UI pickers, not model calls, so tools are the dependable path. Start with tools; add resources later if the picker experience is wanted.

## Pagination and response size

### What the protocol paginates

Cursor-based, opaque cursor, server-chosen page size, `nextCursor` absent means done. Only four operations support it: `resources/list`, `resources/templates/list`, `prompts/list`, `tools/list` ([pagination spec](https://modelcontextprotocol.io/specification/latest/server/utilities/pagination)). `tools/call` results have no protocol pagination. If a tool's data is large, the tool itself needs `limit` and `offset` or `cursor` arguments and should say in its description how to fetch the next page.

### Claude Code limits

From [Claude Code MCP docs](https://code.claude.com/docs/en/mcp), "MCP output limits and warnings":

| Limit | Value | What happens |
|---|---|---|
| Transcript warning | 10,000 tokens | Warning in the transcript viewer. |
| Default token cap | 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`) | Successful results over the cap are saved to a file under `~/.claude/projects/<session>/tool-results/` and replaced in the conversation with the path. Claude then has to read the file. |
| Character cap for text results | 50,000 characters | Same file treatment, regardless of token count. `MAX_MCP_OUTPUT_TOKENS` does not change this. |
| Per-tool override | `_meta["anthropic/maxResultSizeChars"]` on the tool definition, up to 500,000 | Raises that tool's character threshold. Meant for things like full database schemas. |
| Error text | about 11,000 characters | Keeps first and last 5,000. |
| HTTP/SSE response body | 16 MiB | Request fails. Not relevant for stdio. |
| Tool description (loaded upfront) and server instructions | 4,096 characters | Cut; model sees only the start. |
| Tool description (loaded via tool search) | 16,384 characters | Cut. |

Tool search is on by default in Claude Code: only tool names and server instructions load at session start, and tool definitions load when Claude searches for them. Server instructions (the `instructions` field on `McpServer`) therefore matter: they tell Claude when to look for your tools. Put the searchable words at the start of each description ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp), "Scale with MCP tool search").

Claude Desktop publishes no equivalent limits, but the same model context constraints apply and there is no file fallback, so a huge result just eats context.

### Implications for FPL data tools

The FPL `bootstrap-static` endpoint alone returned 1.8 MB of JSON when fetched on 2026-11-20, about 36 times the 50,000-character threshold. A tool that returns it raw will blow past the limit on every call and get written to disk in Claude Code, which costs a second round trip and more tokens. So:

1. Never return upstream FPL JSON unmodified. Project each tool's result down to the fields the question needs, and rename FPL's `element`/`element_type`/`event` vocabulary to glossary terms (`player`, `position`, `gameweek`).
2. Give list tools `limit` (with a default around 20 to 50 and a schema max) and `offset` or an opaque `cursor`, and return `total` plus `nextOffset`/`nextCursor` in `structuredContent` so the model knows there is more. Describe this in the tool description.
3. Give list tools filter arguments (position, team, price range, minutes played) so the model can ask narrow questions instead of paging through everything.
4. Prefer several small tools (`get_manager_summary`, `get_gameweek_picks`, `get_league_standings`, `search_players`) over one `get_everything`. Smaller results and clearer descriptions both help tool search.
5. Use `outputSchema` and `structuredContent` on every data tool. Provide a compact `content` text rendering as well, since that is what the model reads first.
6. Mark read-only tools with `annotations: { readOnlyHint: true }`. FPL reads are all read-only, and hosts can use that to skip approval prompts.
7. Set `anthropic/maxResultSizeChars` only on a tool whose result is legitimately large and needed whole. There is probably no such tool in haul; paginate instead.

## Registering the server in Claude clients

### Claude Code

From [Claude Code MCP docs](https://code.claude.com/docs/en/mcp):

```bash
claude mcp add [options] <name> -- <command> [args...]
claude mcp add --transport stdio haul -- node /abs/path/to/haul/build/index.js
claude mcp add --env FPL_TEAM_ID=123456 --transport stdio haul -- node /abs/path/build/index.js
```

- `--` separates Claude's flags from the server command; without it Claude Code parses the server's own flags.
- `--env KEY=value` sets environment variables. Put another option (such as `--transport stdio`) between `--env` pairs and the server name, or the CLI reads the name as another pair.
- `--scope` is `local` (default, `~/.claude.json` under the project path), `project` (`.mcp.json` at the project root, committed), or `user` (`~/.claude.json`, all projects). Precedence: local > project > user > plugin > claude.ai connectors.

Project-scoped `.mcp.json`:

```json
{
  "mcpServers": {
    "haul": {
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR:-.}/build/index.js"],
      "env": { "FPL_TEAM_ID": "${FPL_TEAM_ID}" }
    }
  }
}
```

`${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`. Claude Code sets `CLAUDE_PROJECT_DIR` for stdio servers, which is what makes a relative `.mcp.json` work. Claude Code asks for approval before using a project-scoped server; `claude mcp reset-project-choices` resets that.

Other commands: `claude mcp list` (with health), `claude mcp get <name>`, `claude mcp remove <name>`, and `/mcp` inside a session. Timeouts: `MCP_TIMEOUT` (startup, ms), `MCP_TOOL_TIMEOUT` (per call, ms), a per-server `timeout` field in `.mcp.json`, and `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (30 minutes default for stdio).

Resources appear as `@haul:fpl://...` mentions; prompts as `/haul:<prompt>` or `/mcp__haul__<prompt>`.

### Claude Desktop

From [connect local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) and the [build-server tutorial](https://modelcontextprotocol.io/docs/develop/build-server):

Config file (open via Claude menu > Settings > Developer > Edit Config, which creates it if missing):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "haul": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/haul/build/index.js"],
      "env": { "FPL_TEAM_ID": "123456" }
    }
  }
}
```

Paths must be absolute. Fully quit and restart Claude Desktop after editing. Servers show under the "Add files, connectors, and more" button > Connectors > Manage connectors. Logs: `~/Library/Logs/Claude/mcp.log` (connection events) and `mcp-server-<name>.log` (the server's stderr) on macOS; `%APPDATA%\Claude\logs` on Windows; `~/.config/Claude/logs` on Linux. `tail -n 20 -f ~/Library/Logs/Claude/mcp*.log` follows them.

No variable expansion is documented for Claude Desktop config, so secrets go in `env` as literals or the server reads them from a file.

### Publishing for others

Both clients run `npx -y <package>` happily (the filesystem server example uses exactly that). If haul ships to npm with a `bin`, users can register it with `claude mcp add --transport stdio haul -- npx -y haul-mcp` and the Desktop equivalent, with no local build.

## Open questions

- Whether Claude Desktop and Claude Code already open with the 2026-07-28 `server/discover` probe or still use `initialize`. The SDK docs do not say. `serveStdio` handles both, so it does not block anything.
- Whether Claude Desktop applies any result size cap. Nothing published. Design for Claude Code's 25,000 tokens / 50,000 characters and Desktop will be fine.

## Sources

- SDK README: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md
- SDK upgrade guide (v1 to v2): https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
- SDK 2026-07-28 protocol support: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html
- SDK tools guide: https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html
- SDK resources guide: https://ts.sdk.modelcontextprotocol.io/v2/servers/resources.html
- SDK stdio serving guide: https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html
- Build an MCP server tutorial: https://modelcontextprotocol.io/docs/develop/build-server
- Connect to local MCP servers (Claude Desktop): https://modelcontextprotocol.io/docs/develop/connect-local-servers
- Server concepts (tools, resources, prompts): https://modelcontextprotocol.io/docs/learn/server-concepts
- Spec, tools: https://modelcontextprotocol.io/specification/latest/server/tools
- Spec, resources: https://modelcontextprotocol.io/specification/latest/server/resources
- Spec, pagination: https://modelcontextprotocol.io/specification/latest/server/utilities/pagination
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- npm registry (`npm view`), 2026-11-20
