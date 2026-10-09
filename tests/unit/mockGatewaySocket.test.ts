import { describe, expect, it } from "vitest";
import { MockGatewaySocket } from "@/lib/gateway/mock/MockGatewaySocket";
import { createGatewaySocket, MOCK_GATEWAY_URL } from "@/lib/gateway/mock/createGatewaySocket";
import { DEMO_AGENTS } from "@/lib/gateway/mock/demoAgents";

type Frame = Record<string, any>;

const open = async () => {
  const socket = new MockGatewaySocket(MOCK_GATEWAY_URL);
  const frames: Frame[] = [];
  socket.onmessage = (ev) => frames.push(JSON.parse(String(ev.data)));
  await new Promise<void>((resolve) => {
    socket.onopen = () => resolve();
  });
  return { socket, frames };
};

const call = async (
  { socket, frames }: Awaited<ReturnType<typeof open>>,
  id: string,
  method: string,
  params: Record<string, unknown> = {}
) => {
  socket.send(JSON.stringify({ type: "req", id, method, params }));
  for (let i = 0; i < 100; i += 1) {
    const res = frames.find((f) => f.type === "res" && f.id === id);
    if (res) return res;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no response for ${method}`);
};

describe("MockGatewaySocket", () => {
  it("sends a connect.challenge once open", async () => {
    const { frames } = await open();
    expect(frames[0]).toMatchObject({ type: "event", event: "connect.challenge" });
  });

  it("rejects requests before connect", async () => {
    const ctx = await open();
    const res = await call(ctx, "1", "agents.list");
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("not_connected");
  });

  it("answers connect with the configured agents", async () => {
    const ctx = await open();
    const hello = await call(ctx, "1", "connect");
    expect(hello.payload.adapterType).toBe("demo");
    const list = await call(ctx, "2", "agents.list");
    expect(list.payload.agents.map((a: Frame) => a.id)).toEqual(DEMO_AGENTS.map((a) => a.id));
  });

  it("streams a chat reply and stores it in history", async () => {
    const ctx = await open();
    await call(ctx, "1", "connect");
    const sessionKey = "agent:ecomos:main";
    const sent = await call(ctx, "2", "chat.send", { sessionKey, message: "hola", idempotencyKey: "run1" });
    expect(sent.payload.status).toBe("started");
    await call(ctx, "3", "agent.wait", { runId: "run1", timeoutMs: 5000 });
    const history = await call(ctx, "4", "chat.history", { sessionKey });
    expect(history.payload.messages).toHaveLength(2);
    expect(history.payload.messages[1].content).toContain("ecomos");
    expect(ctx.frames.some((f) => f.event === "chat" && f.payload.state === "final")).toBe(true);
  });

  it("does not delete the default agent", async () => {
    const ctx = await open();
    await call(ctx, "1", "connect");
    await call(ctx, "2", "agents.delete", { agentId: "ecomos" });
    const list = await call(ctx, "3", "agents.list");
    expect(list.payload.agents.some((a: Frame) => a.id === "ecomos")).toBe(true);
  });

  it("stops delivering after close", async () => {
    const { socket } = await open();
    let closed = false;
    socket.onclose = () => {
      closed = true;
    };
    socket.close();
    expect(closed).toBe(true);
    expect(socket.readyState).toBe(MockGatewaySocket.CLOSED);
  });
});

describe("createGatewaySocket", () => {
  it("returns the mock socket for the mock url", () => {
    expect(createGatewaySocket(MOCK_GATEWAY_URL)).toBeInstanceOf(MockGatewaySocket);
  });
});
