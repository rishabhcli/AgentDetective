import type { CaseState, HealthStatus } from '@thread/domain';
import { Activity, AudioLines, ChevronRight, RadioTower } from 'lucide-react';

interface RuntimeRibbonProps {
  state: CaseState;
  health: HealthStatus | null;
  busyAction: string | null;
  onObservability: () => void;
  onInterview: () => void;
  onStatus: () => void;
}

function shortId(value: string | null): string {
  if (!value) return 'not checkpointed';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function RuntimeRibbon({
  state,
  health,
  busyAction,
  onObservability,
  onInterview,
  onStatus,
}: RuntimeRibbonProps) {
  const run = state.agentRuns[0];
  const completed = run?.steps.filter((step) => step.status === 'completed').length ?? 0;
  const capabilities = health?.capabilities ?? [];
  const readyCapabilities = capabilities.filter((item) => item.active).length;
  const providers = health?.integrations.filter((item) => item.id !== 'mongodb') ?? [];
  const readyProviders = providers.filter((item) => item.active).length;
  const blockedProviders = providers.filter((item) => item.state === 'blocked');

  return (
    <section className="runtime-ribbon" aria-label="Live case runtime observability">
      <button
        className="runtime-local"
        onClick={onStatus}
        aria-label="Open local evidence core status"
      >
        <span className="live-beacon" aria-hidden="true" />
        <div>
          <small>LOCAL EVIDENCE CORE</small>
          <strong>
            {health?.storageMode === 'mongodb' ? 'ATLAS / READY' : 'JSON / FALLBACK'}
          </strong>
        </div>
        <span className="runtime-count">
          {readyCapabilities}/{capabilities.length || '—'} capabilities
        </span>
      </button>

      <button className="runtime-trace" onClick={onObservability}>
        <Activity size={14} aria-hidden="true" />
        <span>
          <small>RUN LEDGER</small>
          <strong>
            {busyAction
              ? `Executing ${busyAction.replaceAll('-', ' ')}…`
              : (run?.trigger ?? 'No run recorded')}
          </strong>
        </span>
        <span className="trace-facts" aria-label="Latest run facts">
          <b>{completed}/7</b> agents
          <i />
          <b>{shortId(run?.checkpointId ?? null)}</b> checkpoint
          <i />
          <b>
            {state.casePackets[0]?.retrievalMethod.replaceAll('-', ' ') ?? 'fixture packet'}
          </b>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>

      <div className="runtime-remote">
        <RadioTower size={13} aria-hidden="true" />
        <span>
          <small>PROVIDERS</small>
          <strong>
            {readyProviders}/{providers.length || 3} live
          </strong>
        </span>
        {blockedProviders.length > 0 ? (
          <em title={blockedProviders.map((item) => item.detail).join('\n')}>
            {blockedProviders.length} blocked
          </em>
        ) : null}
      </div>

      <button className="ribbon-interview" onClick={onInterview}>
        <AudioLines size={14} aria-hidden="true" />
        Interview
      </button>
    </section>
  );
}
