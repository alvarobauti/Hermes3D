// Agents shown by the in-browser gateway (Vercel mode). Edit this list to
// change who appears in the office; ids must be stable and kebab-case.
export type DemoAgent = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  workspace: string;
  intro: string;
  action: string;
};

export const DEFAULT_AGENT_ID = "ecomos";

export const DEMO_AGENTS: readonly DemoAgent[] = [
  {
    id: "ecomos",
    name: "ecomos",
    role: "Agente master de e-commerce",
    emoji: "🛒",
    workspace: "/opt/data/profiles/ecomos",
    intro: "ecomos al habla. Coordino la operativa de e-commerce del equipo.",
    action: "Lo convertiría en pasos concretos, lo repartiría y te resumiría el siguiente movimiento.",
  },
  {
    id: "default",
    name: "default",
    role: "Asistente personal",
    emoji: "🧠",
    workspace: "/opt/data/profiles/default",
    intro: "default por aquí. Soy el asistente personal del equipo.",
    action: "Lo anotaría con su contexto y te propondría el siguiente paso.",
  },
];
