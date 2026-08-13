# Cineflow MCP and Multi-Provider AI Architecture

## Objective

Cineflow will provide two complementary control paths. The web application will include an **AI Producer** that uses the server-side model proxy to turn a request into a validated editing plan. A remote **MCP server** will let compatible AI clients call tightly scoped Cineflow tools.

## MCP Transport and Security

The remote endpoint uses the MCP Streamable HTTP pattern at `/api/mcp`. It accepts JSON-RPC requests and returns JSON responses for non-streaming tools. Browser guest cookies are never accepted as external credentials: every request must present a short-lived, revocable project-scoped capability token in the `Authorization: Bearer …` header.

Tokens grant access to only the selected project, have an expiry, are stored hashed, and carry least-privilege scopes. The first release supports these scopes:

| Scope | Allowed actions |
|---|---|
| `read` | Read project metadata, clip names, and current timeline |
| `edit` | Read access plus set clip trim, reorder clips, and inspect a silence preview |
| `render` | Edit access plus draft an edit plan and create an edit job after an explicit `confirmed: true` parameter |

The first release should return a regular JSON-RPC response rather than hold server-sent-event streams open. This suits the current short, Autoscale workflow and does not require background connections.

## AI Producer Provider Registry

The AI Producer discovers the live catalog through the existing server-side model proxy. It shows every currently available model family, including OpenAI, Anthropic, and Google models exposed through the platform proxy. The browser never receives the proxy credential. A default provider selection is kept only in browser state; the user can select a model per command.

The AI Producer can create **drafts** only. A user must review the structured plan and click the existing create-edit action to start FFmpeg rendering. The same no-side-effect rule applies to MCP `draft` tools; render requires the `cineflow:render` scope and an `confirmed: true` parameter.

## Connecting an MCP Client

1. Open a Cineflow project, set the desired scope and expiry in **MCP access**, and select **Create scoped token**. Copy it immediately; Cineflow stores only a hash and will never display the raw value again.
2. Add the following configuration to an MCP-compatible client. Replace the values with the endpoint and token displayed by Cineflow.

```json
{
  "mcpServers": {
    "cineflow": {
      "url": "https://YOUR-DOMAIN/api/mcp",
      "headers": {
        "Authorization": "Bearer cfmcp_YOUR_PROJECT_SCOPED_TOKEN"
      }
    }
  }
}
```

3. Begin with a `read` token. Issue a separate `edit` or `render` token only for an agent that needs to change the selected project. Use **Revoke** in Cineflow immediately if a token is no longer needed.

> The AI Producer uses all models that are available through Cineflow's live model catalog. It is not a direct pass-through for arbitrary personal API keys, so no provider credential is exposed to the browser.

## Sources

1. MCP Streamable HTTP transport specification: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
2. MCP authorization specification: https://modelcontextprotocol.io/specification/draft/basic/authorization
3. Anthropic introduction to MCP: https://www.anthropic.com/news/model-context-protocol
4. Built-in model proxy instructions: `/home/ubuntu/skills/builtin-llm-models/SKILL.md`
