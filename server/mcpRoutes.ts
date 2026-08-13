import type { Express, Request, Response } from "express";
import * as db from "./db";
import { createJobId, interpretVideoCommand, previewClipSilences, processVideoJob } from "./videoEditing";

type JsonRpcId = string | number | null;
type McpAccess = NonNullable<Awaited<ReturnType<typeof db.resolveMcpAccessToken>>>;

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_TOOLS = [
  {
    name: "cineflow_project_summary",
    description: "Read the title, duration, retention and clip count for the Cineflow project authorized by this token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cineflow_timeline",
    description: "Read the current clip order and trim points. Source URLs and storage keys are never exposed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cineflow_preview_silence",
    description: "Analyze one authorized clip and return silence ranges before rendering. This never changes the source video.",
    inputSchema: {
      type: "object",
      properties: { clipId: { type: "integer", minimum: 1 } },
      required: ["clipId"],
      additionalProperties: false,
    },
  },
  {
    name: "cineflow_apply_trim",
    description: "Set the trim start and/or end for one authorized clip. Requires an edit or render token.",
    inputSchema: {
      type: "object",
      properties: {
        clipId: { type: "integer", minimum: 1 },
        trimStartMs: { type: ["integer", "null"], minimum: 0, maximum: 180000 },
        trimEndMs: { type: ["integer", "null"], minimum: 0, maximum: 180000 },
      },
      required: ["clipId", "trimStartMs", "trimEndMs"],
      additionalProperties: false,
    },
  },
  {
    name: "cineflow_reorder_timeline",
    description: "Replace the clip order with every clip ID exactly once. Requires an edit or render token.",
    inputSchema: {
      type: "object",
      properties: { clipIds: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, maxItems: 12 } },
      required: ["clipIds"],
      additionalProperties: false,
    },
  },
  {
    name: "cineflow_create_render",
    description: "Create and begin a Cineflow render job. This is a side effect and requires a render token plus confirm: true.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 2, maxLength: 1200 },
        confirm: { type: "boolean" },
        model: { type: "string", maxLength: 160 },
        subtitleStyle: {
          type: "object",
          properties: {
            font: { type: "string", enum: ["Noto Sans Thai", "Arial", "Inter"] },
            size: { type: "string", enum: ["small", "medium", "large"] },
            position: { type: "string", enum: ["bottom", "middle", "top"] },
          },
          additionalProperties: false,
        },
      },
      required: ["command", "confirm"],
      additionalProperties: false,
    },
  },
  {
    name: "cineflow_render_status",
    description: "Read the recent render jobs for the authorized project, without exposing output URLs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

function rpcSuccess(res: Response, id: JsonRpcId, result: unknown) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ jsonrpc: "2.0", id, result });
}

function rpcError(res: Response, id: JsonRpcId, code: number, message: string) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(code === -32600 ? 400 : 200).json({ jsonrpc: "2.0", id, error: { code, message } });
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function tokenFromRequest(req: Request) {
  const authorization = req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(cfmcp_[A-Za-z0-9_-]{30,})$/i);
  return match?.[1];
}

async function authenticateMcpRequest(req: Request, res: Response): Promise<McpAccess | undefined> {
  const rawToken = tokenFromRequest(req);
  const access = rawToken ? await db.resolveMcpAccessToken(rawToken) : undefined;
  if (access) return access;
  res.setHeader("WWW-Authenticate", 'Bearer realm="Cineflow MCP"');
  res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid Cineflow MCP capability token is required" } });
  return undefined;
}

function can(access: McpAccess, required: db.McpTokenScope) {
  const levels: Record<db.McpTokenScope, number> = { read: 1, edit: 2, render: 3 };
  return levels[access.scope] >= levels[required];
}

function asPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function asTrim(value: unknown) {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 180000) ? value : undefined;
}

function cleanSubtitleStyle(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const font = input.font === "Arial" || input.font === "Inter" || input.font === "Noto Sans Thai" ? input.font : "Noto Sans Thai";
  const size = input.size === "small" || input.size === "large" || input.size === "medium" ? input.size : "medium";
  const position = input.position === "top" || input.position === "middle" || input.position === "bottom" ? input.position : "bottom";
  return { font, size, position } as const;
}

async function callTool(access: McpAccess, name: string, args: Record<string, unknown>) {
  const project = await db.getVideoProjectForUser(access.projectId, access.userId);
  if (!project) return textResult("The authorized Cineflow project is unavailable or has expired.", true);
  const clips = await db.listVideoClips(project.id, access.userId);

  if (name === "cineflow_project_summary") {
    return textResult({ project: { id: project.id, title: project.title, durationSeconds: project.durationSeconds, expiresAt: project.expiresAt, clipCount: clips.length } });
  }
  if (name === "cineflow_timeline") {
    return textResult({ clips: clips.map(clip => ({ id: clip.id, name: clip.originalName, sortOrder: clip.sortOrder, trimStartMs: clip.trimStartMs, trimEndMs: clip.trimEndMs })) });
  }
  if (name === "cineflow_preview_silence") {
    const clipId = asPositiveInteger(args.clipId);
    const clip = clips.find(item => item.id === clipId);
    if (!clip) return textResult("clipId is invalid for this authorized project.", true);
    return textResult(await previewClipSilences(clip.storageKey, clip.trimStartMs, clip.trimEndMs));
  }
  if (name === "cineflow_apply_trim") {
    if (!can(access, "edit")) return textResult("This tool requires an edit or render token.", true);
    const clipId = asPositiveInteger(args.clipId);
    const start = asTrim(args.trimStartMs);
    const end = asTrim(args.trimEndMs);
    if (!clipId || start === undefined || end === undefined || (start !== null && end !== null && end <= start)) return textResult("Provide valid trim values with trimEndMs after trimStartMs.", true);
    const clip = await db.updateVideoClipTrim(project.id, clipId, access.userId, start, end);
    return clip ? textResult({ clip: { id: clip.id, trimStartMs: clip.trimStartMs, trimEndMs: clip.trimEndMs } }) : textResult("clipId is invalid for this authorized project.", true);
  }
  if (name === "cineflow_reorder_timeline") {
    if (!can(access, "edit")) return textResult("This tool requires an edit or render token.", true);
    const ids = Array.isArray(args.clipIds) ? args.clipIds.map(asPositiveInteger) : [];
    if (!ids.length || ids.some(id => !id)) return textResult("clipIds must be positive integers.", true);
    const timeline = await db.reorderVideoClips(project.id, access.userId, ids as number[]);
    return textResult({ clips: timeline.map(clip => ({ id: clip.id, sortOrder: clip.sortOrder })) });
  }
  if (name === "cineflow_create_render") {
    if (!can(access, "render")) return textResult("This tool requires a render token.", true);
    if (args.confirm !== true) return textResult("Rendering changes project outputs. Repeat the call with confirm: true after user confirmation.", true);
    const command = typeof args.command === "string" ? args.command.trim().slice(0, 1200) : "";
    if (command.length < 2) return textResult("Provide a command between 2 and 1200 characters.", true);
    const model = typeof args.model === "string" ? args.model.trim().slice(0, 160) : undefined;
    const operationPlan = await interpretVideoCommand(command, model || undefined);
    const subtitleStyle = cleanSubtitleStyle(args.subtitleStyle);
    const job = await db.createEditJob({
      id: createJobId(),
      projectId: project.id,
      userId: access.userId,
      command,
      commandLanguage: operationPlan.sourceLanguage,
      operationPlan,
      status: "queued",
      progress: 0,
      subtitleFont: subtitleStyle.font,
      subtitleSize: subtitleStyle.size,
      subtitlePosition: subtitleStyle.position,
      subtitlePreset: "custom",
    });
    void processVideoJob(job.id, access.userId).catch(error => console.error("[MCP] Background render failed", error));
    return textResult({ job: { id: job.id, status: job.status, progress: job.progress, summary: operationPlan.summary } });
  }
  if (name === "cineflow_render_status") {
    const jobs = (await db.listEditJobsForUser(access.userId)).filter(job => job.projectId === project.id).slice(0, 10);
    return textResult({ jobs: jobs.map(job => ({ id: job.id, status: job.status, progress: job.progress, command: job.command, errorMessage: job.errorMessage, createdAt: job.createdAt })) });
  }
  return textResult(`Unknown Cineflow MCP tool: ${name}`, true);
}

export function registerMcpRoutes(app: Express) {
  app.get("/api/mcp", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(405).json({ error: "Cineflow MCP uses Streamable HTTP POST requests with a Bearer capability token." });
  });

  app.post("/api/mcp", async (req, res) => {
    const body = req.body as { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: unknown } | undefined;
    const id = body?.id ?? null;
    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(res, id, -32600, "Invalid JSON-RPC request");
    const access = await authenticateMcpRequest(req, res);
    if (!access) return;
    if (body.method === "notifications/initialized") return res.status(202).end();
    if (body.method === "initialize") return rpcSuccess(res, id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "Cineflow", version: "1.0.0" },
      instructions: "This token is limited to one Cineflow project. Source URLs, storage keys, and other projects are never available through MCP.",
    });
    if (body.method === "ping") return rpcSuccess(res, id, {});
    if (body.method === "tools/list") return rpcSuccess(res, id, { tools: MCP_TOOLS });
    if (body.method === "tools/call") {
      const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
      return rpcSuccess(res, id, await callTool(access, name, args));
    }
    return rpcError(res, id, -32601, `Unsupported MCP method: ${body.method}`);
  });
}
