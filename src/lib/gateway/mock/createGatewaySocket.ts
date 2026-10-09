import { MockGatewaySocket } from "./MockGatewaySocket";

export const MOCK_GATEWAY_URL = "mock://office";

/** True when the build runs the office against the in-browser gateway (Vercel mode). */
export const isMockGatewayEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_MOCK_GATEWAY === "1";

export const createGatewaySocket = (url: string): WebSocket =>
  (url === MOCK_GATEWAY_URL
    ? new MockGatewaySocket(url)
    : new WebSocket(url)) as unknown as WebSocket;
