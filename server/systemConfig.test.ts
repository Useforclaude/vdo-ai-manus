import { afterEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
const mockDb = {
  getSystemSetting: vi.fn(async (key: string) => settings.has(key) ? { encryptedValue: settings.get(key)! } : undefined),
  upsertSystemSetting: vi.fn(async (key: string, value: string) => { settings.set(key, value); }),
  pingDatabase: vi.fn(async () => undefined),
};

vi.mock("./db", () => mockDb);
vi.mock("./runtimeConfig", () => ({
  getOpenAiCompatibleUrl: (baseUrl: string, endpoint: string) => new URL(endpoint, `${baseUrl.replace(/\/$/, "")}/`).toString(),
  runtimeConfig: {
    app: { cookieSecure: false },
    llm: { baseUrl: "", apiKey: undefined, defaultModel: "gpt-4.1-mini" },
    transcription: { baseUrl: "", apiKey: undefined, model: "whisper-1" },
    storage: { driver: "local", localPath: "/tmp/cineflow", bucket: undefined, region: "us-east-1", endpoint: undefined, accessKeyId: undefined, secretAccessKey: undefined, forcePathStyle: true },
  },
}));
vi.mock("./storage", () => ({ checkStorageHealth: vi.fn(async () => ({ ok: true, detail: "Object storage connection verified" })) }));

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  settings.clear();
  vi.clearAllMocks();
});

describe("self-hosted system configuration", () => {
  it("encrypts provider credentials at rest and exposes only masked values", async () => {
    process.env.CINEFLOW_CONFIG_ENCRYPTION_KEY = "test-configuration-encryption-key";
    const { getPublicProviderConfiguration, getRuntimeProviderConfig, saveProviderConfiguration } = await import("./systemConfig");
    await saveProviderConfiguration({
      ai: { llmBaseUrl: "https://ai.example.test/v1", llmApiKey: "sk-private-1234", llmDefaultModel: "cineflow-model" },
      storage: { driver: "s3", endpoint: "http://minio:9000", bucket: "videos", region: "us-east-1", accessKeyId: "minio-user", secretAccessKey: "minio-secret-5678", forcePathStyle: true },
    });
    const stored = [...settings.values()].join(" ");
    const publicConfig = await getPublicProviderConfiguration();
    const runtime = await getRuntimeProviderConfig();

    expect(stored).not.toContain("sk-private-1234");
    expect(stored).not.toContain("minio-secret-5678");
    expect(publicConfig.ai.llmApiKey).toBe("••••1234");
    expect(publicConfig.storage.secretAccessKey).toBe("••••5678");
    expect(runtime.ai.llmApiKey).toBe("sk-private-1234");
    expect(runtime.storage.secretAccessKey).toBe("minio-secret-5678");
  });

  it("creates a time-limited, signed administrator cookie only for the configured token", async () => {
    process.env.CINEFLOW_ADMIN_TOKEN = "administrator-token";
    process.env.CINEFLOW_ADMIN_SESSION_SECRET = "separate-signing-secret";
    const { ADMIN_COOKIE_NAME, isAdminSession, unlockAdminSession } = await import("./systemConfig");
    const request = { headers: { cookie: "" }, secure: false, get: vi.fn(() => undefined) } as any;
    const response = { cookie: vi.fn() } as any;

    expect(unlockAdminSession(request, response, "wrong-token")).toBe(false);
    expect(unlockAdminSession(request, response, "administrator-token")).toBe(true);
    const cookieValue = response.cookie.mock.calls[0][1];
    expect(isAdminSession({ ...request, headers: { cookie: `${ADMIN_COOKIE_NAME}=${cookieValue}` } })).toBe(true);
  });

  it("reports healthy dependencies without including credentials in health detail", async () => {
    process.env.CINEFLOW_CONFIG_ENCRYPTION_KEY = "test-configuration-encryption-key";
    const { saveProviderConfiguration } = await import("./systemConfig");
    await saveProviderConfiguration({ ai: { llmBaseUrl: "https://ai.example.test/v1", llmApiKey: "test-secret-9999", llmDefaultModel: "cineflow-model" }, storage: { driver: "local", localPath: "/tmp/cineflow" } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getSystemHealth } = await import("./systemHealth");
    const health = await getSystemHealth();

    expect(health.map(item => item.status)).toEqual(["healthy", "healthy", "healthy"]);
    expect(JSON.stringify(health)).not.toContain("test-secret-9999");
    vi.unstubAllGlobals();
  });
});
