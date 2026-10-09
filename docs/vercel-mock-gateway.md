# Vercel mode (in-browser gateway)

Vercel cannot run `server/index.js` (custom Node server + WebSocket proxy), so a
normal Hermes3D build has no gateway to talk to there. With
`NEXT_PUBLIC_MOCK_GATEWAY=1` (set in `vercel.json`) the browser talks to an
in-memory gateway instead (`src/lib/gateway/mock/`), which speaks the same
protocol as `server/demo-gateway-adapter.js`.

- Agents shown in the office: edit `src/lib/gateway/mock/demoAgents.ts`.
- Replies are canned; nothing leaves the browser and state resets on reload.
- Unset the variable (or use Docker / `npm run dev`) to use a real gateway.
