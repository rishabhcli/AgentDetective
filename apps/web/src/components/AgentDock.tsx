import { BorderBeam } from 'border-beam';
import { ThinkingOrb } from 'thinking-orbs';
import { AudioLines, ChevronUp, MessageCircleMore, ScrollText } from 'lucide-react';
import type { AgentName, CaseState, HealthStatus } from '@thread/domain';

interface AgentDockProps {
  state: CaseState;
  health: HealthStatus | null;
  busyAction: string | null;
  onAsk: () => void;
  onInterview: () => void;
  onLedger: () => void;
}

const agents: Array<{
  name: AgentName;
  label: string;
  orb:
    | 'working'
    | 'searching'
    | 'solving'
    | 'listening'
    | 'connecting'
    | 'weaving'
    | 'composing';
}> = [
  { name: 'INGESTOR', label: 'Ingestor', orb: 'composing' },
  { name: 'RESOLVER', label: 'Resolver', orb: 'connecting' },
  { name: 'CHRONOLOGIST', label: 'Chronologist', orb: 'weaving' },
  { name: 'LINKER', label: 'Linker', orb: 'connecting' },
  { name: 'HYPOTHESIS ENGINE', label: 'Hypothesis', orb: 'solving' },
  { name: 'FALSIFIER', label: 'Falsifier', orb: 'searching' },
  { name: 'INVESTIGATOR', label: 'Investigator', orb: 'working' },
];

export function AgentDock({
  state,
  health,
  busyAction,
  onAsk,
  onInterview,
  onLedger,
}: AgentDockProps) {
  const latestRun = state.agentRuns[0];
  const openRouterReady =
    health?.integrations.some(
      (integration) => integration.id === 'openrouter' && integration.active,
    ) ?? false;
  const voiceReady =
    health?.integrations.some(
      (integration) => integration.id === 'elevenlabs' && integration.active,
    ) ?? false;

  return (
    <details className="agent-dock">
      <summary aria-label="Open case agent dock">
        <span className="agent-orb-stack" aria-hidden="true">
          <ThinkingOrb state="solving" size={20} theme="dark" paused={!busyAction} />
          <ThinkingOrb state="searching" size={20} theme="dark" paused={!busyAction} />
          <ThinkingOrb state="connecting" size={20} theme="dark" paused={!busyAction} />
        </span>
        <span>
          <strong>Case agents</strong>
          <small>{busyAction ? 'transform in progress' : 'inspect or ask'}</small>
        </span>
        <ChevronUp size={15} aria-hidden="true" />
      </summary>

      <div className="agent-dock-panel">
        <header>
          <span>
            <strong>Case team</strong>
            <small>Latest persisted run—not simulated activity</small>
          </span>
          <b>{latestRun?.status ?? 'no run'}</b>
        </header>

        <div className="agent-dock-grid">
          {agents.map((agent) => {
            const step = latestRun?.steps.find((item) => item.agent === agent.name);
            const status = step?.status ?? 'not selected';
            return (
              <button key={agent.name} onClick={onLedger} title={step?.detail ?? status}>
                <ThinkingOrb
                  state={agent.orb}
                  size={20}
                  theme="dark"
                  paused
                  aria-label={`${agent.label}: ${status}`}
                />
                <span>
                  <strong>{agent.label}</strong>
                  <small>{status}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="agent-dock-actions">
          <BorderBeam
            size="pulse-outside"
            colorVariant="mono"
            theme="dark"
            strength={openRouterReady ? 0.75 : 0}
            active={openRouterReady}
          >
            <button
              className="ask-agents-button"
              onClick={onAsk}
              disabled={!openRouterReady}
            >
              <MessageCircleMore size={16} aria-hidden="true" />
              <span>
                <strong>Ask the agents</strong>
                <small>
                  {openRouterReady ? 'Two model families' : 'OpenRouter unavailable'}
                </small>
              </span>
            </button>
          </BorderBeam>
          <button onClick={onInterview} disabled={!voiceReady}>
            <AudioLines size={16} aria-hidden="true" />
            <span>
              <strong>Witness room</strong>
              <small>{voiceReady ? 'Live voice session' : 'ElevenLabs unavailable'}</small>
            </span>
          </button>
          <button onClick={onLedger}>
            <ScrollText size={16} aria-hidden="true" />
            <span>
              <strong>Run ledger</strong>
              <small>Inputs, outputs, checkpoints</small>
            </span>
          </button>
        </div>
      </div>
    </details>
  );
}
