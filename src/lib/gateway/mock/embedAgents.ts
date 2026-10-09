import type { DemoAgent } from "./demoAgents";

/**
 * Embedded mode: the office runs inside an iframe of the owner's dashboard and the
 * dashboard (parent) sends the real agents over postMessage. Nothing travels in the
 * URL, and only the origin configured at build time is trusted.
 */

export const EMBED_READY_MESSAGE = "hermes3d:ready";
export const EMBED_AGENTS_MESSAGE = "hermes3d:agents";

const MAX_AGENTS = 50;
const ID_PATTERN = /^[\w.:-]{1,80}$/;
const WAIT_FOR_PARENT_MS = 4000;

type Activity = "working" | "connected" | "offline" | "revoked";
const ACTIVITY_TEXT: Record<Activity, string> = {
  working: "Trabajando ahora en una tarea del cerebro.",
  connected: "Conectado, sin tarea reciente.",
  offline: "Sin sesión activa.",
  revoked: "Token revocado.",
};
const ACTIVITY_EMOJI: Record<Activity, string> = {
  working: "⚙️",
  connected: "🟢",
  offline: "💤",
  revoked: "⛔",
};

const parentOrigin = (): string => process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGIN?.trim() ?? "";

/** True inside an iframe opened with ?embed=1 on a build that names a trusted parent. */
export const isEmbedded = (): boolean => {
  if (typeof window === "undefined" || !parentOrigin()) return false;
  if (window.parent === window) return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
};

const asText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Validates the untrusted payload; invalid entries are dropped, never repaired. */
export const parseEmbedAgents = (payload: unknown): DemoAgent[] => {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const agents: DemoAgent[] = [];
  for (const raw of payload.slice(0, MAX_AGENTS)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = asText(entry.id, 80);
    const name = asText(entry.name, 60);
    if (!ID_PATTERN.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const activity = (entry.activity as Activity) in ACTIVITY_TEXT ? (entry.activity as Activity) : "offline";
    const role = asText(entry.role, 80) || ACTIVITY_TEXT[activity];
    agents.push({
      id,
      name,
      role,
      emoji: ACTIVITY_EMOJI[activity],
      workspace: `/cerebro/${id}`,
      intro: `${name} al habla. ${ACTIVITY_TEXT[activity]}`,
      action: "Esta vista es solo de lectura: el chat no ejecuta nada en el cerebro.",
    });
  }
  return agents;
};

/**
 * Asks the parent for the agents and resolves with them. If the parent never answers
 * the result is an empty list, not demo agents: an empty floor is honest, invented
 * agents would read as real ones.
 */
export const waitForEmbedAgents = (): Promise<DemoAgent[]> =>
  new Promise((resolve) => {
    const origin = parentOrigin();
    const finish = (agents: DemoAgent[]) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(agents);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      const data = event.data as { type?: unknown; agents?: unknown } | null;
      if (data?.type !== EMBED_AGENTS_MESSAGE) return;
      finish(parseEmbedAgents(data.agents));
    };
    const timer = window.setTimeout(() => finish([]), WAIT_FOR_PARENT_MS);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: EMBED_READY_MESSAGE }, origin);
  });
