import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMBED_AGENTS_MESSAGE,
  EMBED_READY_MESSAGE,
  parseEmbedAgents,
  waitForEmbedAgents,
} from "@/lib/gateway/mock/embedAgents";

const ORIGIN = "https://dashboard.example";

describe("parseEmbedAgents", () => {
  it("maps valid agents and keeps activity in the text", () => {
    const [agent] = parseEmbedAgents([{ id: "a-1", name: "Claude", activity: "working" }]);
    expect(agent).toMatchObject({ id: "a-1", name: "Claude", emoji: "⚙️" });
    expect(agent.role).toContain("Trabajando");
  });

  it("drops non-arrays, bad ids, empty names and duplicates", () => {
    expect(parseEmbedAgents("nope")).toEqual([]);
    const agents = parseEmbedAgents([
      { id: "ok", name: "A" },
      { id: "ok", name: "dup" },
      { id: "has space", name: "B" },
      { id: "no-name", name: "  " },
      null,
      42,
    ]);
    expect(agents.map((a) => a.id)).toEqual(["ok"]);
  });

  it("treats unknown activity as offline and caps the list", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `id${i}`, name: `n${i}`, activity: "weird" }));
    const agents = parseEmbedAgents(many);
    expect(agents).toHaveLength(50);
    expect(agents[0].emoji).toBe("💤");
  });
});

describe("waitForEmbedAgents", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const arrange = () => {
    vi.stubEnv("NEXT_PUBLIC_EMBED_PARENT_ORIGIN", ORIGIN);
    const post = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    return post;
  };
  const send = (init: MessageEventInit) =>
    window.dispatchEvent(new MessageEvent("message", init));

  it("announces ready to the trusted origin and resolves with the parent's agents", async () => {
    const post = arrange();
    const promise = waitForEmbedAgents();
    expect(post).toHaveBeenCalledWith({ type: EMBED_READY_MESSAGE }, ORIGIN);
    send({
      origin: ORIGIN,
      source: window.parent as unknown as MessageEventSource,
      data: { type: EMBED_AGENTS_MESSAGE, agents: [{ id: "x", name: "X" }] },
    });
    await expect(promise).resolves.toHaveLength(1);
  });

  it("ignores messages from other origins and falls back to an empty floor", async () => {
    vi.useFakeTimers();
    arrange();
    const promise = waitForEmbedAgents();
    send({
      origin: "https://evil.example",
      source: window.parent as unknown as MessageEventSource,
      data: { type: EMBED_AGENTS_MESSAGE, agents: [{ id: "x", name: "X" }] },
    });
    await vi.advanceTimersByTimeAsync(4100);
    await expect(promise).resolves.toEqual([]);
  });
});
