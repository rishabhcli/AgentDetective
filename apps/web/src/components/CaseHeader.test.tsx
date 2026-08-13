// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSampleCase, type HealthStatus } from '@thread/domain';
import { CaseHeader } from './CaseHeader.js';

describe('CaseHeader', () => {
  it('labels the synthetic case and reports the honest engine mode', () => {
    const onStatus = vi.fn();
    const health: HealthStatus = {
      ok: true,
      storageMode: 'local-json',
      engineLabel: 'Local evidence engine',
      integrations: [],
    };
    render(
      <CaseHeader
        state={createSampleCase()}
        health={health}
        busyAction={null}
        counterEvidencePresent={false}
        onUpload={vi.fn()}
        onCounterEvidence={vi.fn()}
        onChanges={vi.fn()}
        onStatus={onStatus}
      />,
    );
    expect(screen.getByText('The Badge 17 discrepancy')).toBeInTheDocument();
    expect(screen.getByText('DEMO CASE')).toBeInTheDocument();
    expect(screen.getByText('Local evidence engine')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open engine status' }));
    expect(onStatus).toHaveBeenCalledOnce();
  });
});
