import { DEFAULT_AGENT_ID, DEMO_AGENTS, type DemoAgent } from "./demoAgents";

/**
 * In-browser stand-in for the demo gateway (server/demo-gateway-adapter.js).
 * It speaks the same frame protocol over a WebSocket-shaped object so the
 * office runs on static hosting (Vercel) with no gateway process.
 */

type Frame = Record<string, unknown>;
type Params = Record<string, unknown>;
type Message = { role: "user" | "assistant"; content: string };
type EmitFn = (frame: Frame) => void;

const MAIN_KEY = "main";
const MODELS = [{ id: "demo/mock-office", name: "Mock Office", provider: "demo" }];
const METHODS = [
  "agents.list", "agents.create", "agents.delete", "agents.update",
  "sessions.list", "sessions.preview", "sessions.patch", "sessions.reset",
  "chat.send", "chat.abort", "chat.history", "agent.wait", "status",
  "config.get", "config.set", "config.patch", "agents.files.get", "agents.files.set",
  "exec.approvals.get", "exec.approvals.set", "exec.approval.resolve",
  "wake", "skills.status", "models.list", "cron.list",
];

const randomId = () => crypto.randomUUID().replace(/-/g, "");
const sessionKeyFor = (agentId: string) => `agent:${agentId}:${MAIN_KEY}`;
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const ok = (id: string, payload: unknown = {}): Frame => ({ type: "res", id, ok: true, payload });
const err = (id: string, code: string, message: string): Frame => ({
  type: "res", id, ok: false, error: { code, message },
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class MockGatewayBackend {
  private agents = new Map<string, DemoAgent>(DEMO_AGENTS.map((a) => [a.id, a]));
  private files = new Map<string, string>();
  private sessionSettings = new Map<string, { model?: string; thinkingLevel?: string }>();
  private history = new Map<string, Message[]>();
  private runs = new Map<string, { sessionKey: string; abort: () => void }>();

  constructor(private readonly emit: EmitFn) {}

  helloPayload(): Frame {
    return {
      type: "hello-ok",
      protocol: 3,
      adapterType: "demo",
      features: { methods: METHODS, events: ["chat", "presence", "heartbeat"] },
      snapshot: {
        health: {
          agents: [...this.agents.values()].map((a) => ({
            agentId: a.id, name: a.name, isDefault: a.id === DEFAULT_AGENT_ID,
          })),
          defaultAgentId: DEFAULT_AGENT_ID,
        },
        sessionDefaults: { mainKey: MAIN_KEY },
      },
      auth: { role: "operator", scopes: ["operator.admin"] },
      policy: { tickIntervalMs: 30000 },
    };
  }

  private hist(key: string): Message[] {
    const list = this.history.get(key) ?? [];
    this.history.set(key, list);
    return list;
  }

  private recent() {
    return [...this.agents.keys()].flatMap((agentId) => {
      const key = sessionKeyFor(agentId);
      return this.hist(key).length > 0 ? [{ key, updatedAt: Date.now() }] : [];
    });
  }

  private reply(agent: DemoAgent, message: string): string {
    const text = message.replace(/\s+/g, " ").trim();
    if (/^(hola|hi|hello|hey|buenas|qué tal)[!.? ]*$/i.test(text)) {
      return `${agent.intro} Dime una tarea concreta y te respondo con el siguiente paso.`;
    }
    const focus = text.length > 160 ? `${text.slice(0, 160).trimEnd()}...` : text;
    return `${agent.intro} Enfoque: ${focus}. ${agent.action}`;
  }

  async handle(method: string, p: Params, id: string): Promise<Frame> {
    switch (method) {
      case "agents.list":
        return ok(id, {
          defaultId: DEFAULT_AGENT_ID,
          mainKey: MAIN_KEY,
          agents: [...this.agents.values()].map((a) => ({
            id: a.id, name: a.name, workspace: a.workspace, role: a.role,
            identity: { name: a.name, emoji: a.emoji },
          })),
        });
      case "agents.create": {
        const name = str(p.name).trim() || "Nuevo agente";
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agente";
        const agentId = `${slug}-${randomId().slice(0, 6)}`;
        const base = DEMO_AGENTS[1];
        this.agents.set(agentId, { ...base, id: agentId, name, role: str(p.role).trim(), workspace: `/demo/${slug}` });
        this.emit({ type: "event", event: "presence", payload: { sessions: { recent: [], byAgent: [] } } });
        return ok(id, { agentId, name, workspace: `/demo/${slug}` });
      }
      case "agents.update": {
        const agent = this.agents.get(str(p.agentId).trim());
        if (!agent) return err(id, "not_found", `Agent ${str(p.agentId)} not found`);
        this.agents.set(agent.id, {
          ...agent,
          name: str(p.name).trim() || agent.name,
          role: typeof p.role === "string" ? p.role.trim() : agent.role,
        });
        return ok(id, { ok: true, removedBindings: 0 });
      }
      case "agents.delete": {
        const agentId = str(p.agentId).trim();
        if (agentId && agentId !== DEFAULT_AGENT_ID && this.agents.delete(agentId)) {
          this.history.delete(sessionKeyFor(agentId));
        }
        return ok(id, { ok: true, removedBindings: 0 });
      }
      case "agents.files.get": {
        const content = this.files.get(`${str(p.agentId, DEFAULT_AGENT_ID)}/${str(p.name)}`);
        return ok(id, { file: content !== undefined ? { content } : { missing: true } });
      }
      case "agents.files.set":
        this.files.set(`${str(p.agentId, DEFAULT_AGENT_ID)}/${str(p.name)}`, str(p.content));
        return ok(id);
      case "config.get":
        return ok(id, {
          config: { gateway: { reload: { mode: "hot" } } },
          hash: "demo-gateway", exists: true, path: "/demo/config.json",
        });
      case "config.patch":
      case "config.set":
        return ok(id, { hash: "demo-gateway" });
      case "exec.approvals.get":
        return ok(id, {
          path: "", exists: true, hash: "demo-approvals",
          file: { version: 1, defaults: { security: "full", ask: "off", autoAllowSkills: true }, agents: {} },
        });
      case "exec.approvals.set":
        return ok(id, { hash: "demo-approvals" });
      case "exec.approval.resolve":
        return ok(id, { ok: true });
      case "models.list":
        return ok(id, { models: MODELS });
      case "skills.status":
        return ok(id, { skills: [{ name: "TASK-MANAGER", status: "installed", version: "1.0.0" }] });
      case "cron.list":
        return ok(id, { jobs: [] });
      case "cron.add":
      case "cron.run":
      case "cron.remove":
        return err(id, "unsupported_method", `La demo no soporta ${method}.`);
      case "sessions.list":
        return ok(id, {
          sessions: [...this.agents.values()].map((a) => {
            const key = sessionKeyFor(a.id);
            return {
              key, agentId: a.id, displayName: "Main",
              updatedAt: this.hist(key).length > 0 ? Date.now() : null,
              origin: { label: a.name, provider: "demo" },
              model: this.sessionSettings.get(key)?.model ?? MODELS[0].id,
              modelProvider: "demo",
            };
          }),
        });
      case "sessions.preview": {
        const keys = Array.isArray(p.keys) ? (p.keys as string[]) : [];
        const limit = typeof p.limit === "number" ? p.limit : 8;
        const maxChars = typeof p.maxChars === "number" ? p.maxChars : 240;
        const previews = keys.map((key) => {
          const h = this.hist(key);
          if (h.length === 0) return { key, status: "empty", items: [] };
          const items = h.slice(-limit).map((m) => ({
            role: m.role, text: m.content.slice(0, maxChars), timestamp: Date.now(),
          }));
          return { key, status: "ok", items };
        });
        return ok(id, { ts: Date.now(), previews });
      }
      case "sessions.patch": {
        const key = str(p.key, sessionKeyFor(DEFAULT_AGENT_ID));
        const next = { ...this.sessionSettings.get(key) };
        if (p.model !== undefined) next.model = p.model as string;
        if (p.thinkingLevel !== undefined) next.thinkingLevel = p.thinkingLevel as string;
        this.sessionSettings.set(key, next);
        return ok(id, {
          ok: true, key, entry: { thinkingLevel: next.thinkingLevel },
          resolved: { model: next.model ?? MODELS[0].id, modelProvider: "demo" },
        });
      }
      case "sessions.reset":
        this.history.delete(str(p.key, sessionKeyFor(DEFAULT_AGENT_ID)));
        return ok(id, { ok: true });
      case "chat.send":
        return this.chatSend(p, id);
      case "chat.abort":
        return ok(id, { ok: true, aborted: this.abortRuns(str(p.runId).trim(), str(p.sessionKey).trim()) });
      case "chat.history": {
        const sessionKey = str(p.sessionKey, sessionKeyFor(DEFAULT_AGENT_ID));
        return ok(id, { sessionKey, messages: this.hist(sessionKey) });
      }
      case "agent.wait": {
        const runId = str(p.runId);
        const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 30000;
        const start = Date.now();
        while (this.runs.has(runId) && Date.now() - start < timeoutMs) await sleep(50);
        return ok(id, { status: this.runs.has(runId) ? "running" : "done" });
      }
      case "status": {
        const recent = this.recent();
        return ok(id, {
          sessions: {
            recent,
            byAgent: [...this.agents.keys()].map((agentId) => ({
              agentId, recent: recent.filter((e) => e.key.includes(`:${agentId}:`)),
            })),
          },
        });
      }
      default:
        return ok(id);
    }
  }

  private abortRuns(runId: string, sessionKey: string): number {
    let aborted = 0;
    for (const [rid, run] of [...this.runs.entries()]) {
      if ((runId && rid !== runId) || (!runId && run.sessionKey !== sessionKey)) continue;
      run.abort();
      this.runs.delete(rid);
      aborted += 1;
    }
    return aborted;
  }

  private chatSend(p: Params, id: string): Frame {
    const sessionKey = str(p.sessionKey, sessionKeyFor(DEFAULT_AGENT_ID));
    const agentId = sessionKey.startsWith("agent:") ? sessionKey.split(":")[1] : DEFAULT_AGENT_ID;
    const agent = this.agents.get(agentId) ?? DEMO_AGENTS[0];
    const message = str(p.message).trim();
    const runId = str(p.idempotencyKey) || randomId();
    if (!message) return ok(id, { status: "no-op", runId });

    let aborted = false;
    this.runs.set(runId, { sessionKey, abort: () => { aborted = true; } });
    void this.streamReply({ runId, sessionKey, agent, message, isAborted: () => aborted });
    return ok(id, { status: "started", runId });
  }

  private async streamReply(args: {
    runId: string; sessionKey: string; agent: DemoAgent; message: string; isAborted: () => boolean;
  }) {
    const { runId, sessionKey, agent, message, isAborted } = args;
    let seq = 0;
    const chat = (state: string, extra: Frame) =>
      this.emit({ type: "event", event: "chat", seq: seq++, payload: { runId, sessionKey, state, ...extra } });
    try {
      await sleep(0);
      const reply = this.reply(agent, message);
      let partial = "";
      for (const word of reply.split(" ")) {
        if (isAborted()) break;
        partial = partial ? `${partial} ${word}` : word;
        chat("delta", { message: { role: "assistant", content: partial } });
        await sleep(45);
      }
      if (isAborted()) return chat("aborted", {});
      const h = this.hist(sessionKey);
      h.push({ role: "user", content: message }, { role: "assistant", content: reply });
      chat("final", { stopReason: "end_turn", message: { role: "assistant", content: reply } });
      const recent = [{ key: sessionKey, updatedAt: Date.now() }];
      this.emit({
        type: "event", event: "presence", seq: seq++,
        payload: { sessions: { recent, byAgent: [{ agentId: agent.id, recent }] } },
      });
    } finally {
      this.runs.delete(runId);
    }
  }
}

type Listener = (ev: Record<string, unknown>) => void;

/** Minimal WebSocket look-alike: onopen/onmessage/onclose/onerror, send, close, readyState. */
export class MockGatewaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockGatewaySocket.CONNECTING;
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onclose: Listener | null = null;
  onerror: Listener | null = null;

  private connected = false;
  private globalSeq = 0;
  private readonly backend: MockGatewayBackend;

  constructor(readonly url: string) {
    this.backend = new MockGatewayBackend((frame) => this.deliver(frame));
    setTimeout(() => {
      if (this.readyState !== MockGatewaySocket.CONNECTING) return;
      this.readyState = MockGatewaySocket.OPEN;
      this.onopen?.({});
      this.deliver({ type: "event", event: "connect.challenge", payload: { nonce: randomId() } });
    }, 0);
  }

  private deliver(frame: Frame) {
    if (this.readyState !== MockGatewaySocket.OPEN) return;
    const out = frame.type === "event" && typeof frame.seq !== "number"
      ? { ...frame, seq: this.globalSeq++ }
      : frame;
    this.onmessage?.({ data: JSON.stringify(out) });
  }

  send(raw: string) {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }
    const { id, method, params } = frame;
    if (frame.type !== "req" || typeof id !== "string" || typeof method !== "string") return;
    void this.dispatch(id, method, (params ?? {}) as Params);
  }

  private async dispatch(id: string, method: string, params: Params) {
    if (method === "connect") {
      this.connected = true;
      this.deliver(ok(id, this.backend.helloPayload()));
      return;
    }
    if (!this.connected) return this.deliver(err(id, "not_connected", "Send connect first."));
    try {
      this.deliver(await this.backend.handle(method, params, id));
    } catch (e) {
      this.deliver(err(id, "internal_error", e instanceof Error ? e.message : "Internal error"));
    }
  }

  close(code = 1000, reason = "") {
    if (this.readyState === MockGatewaySocket.CLOSED) return;
    this.readyState = MockGatewaySocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}
