import {
  createHackathonCase,
  createSampleCase,
  validateCaseIntegrity,
  type CaseIntegrityReport,
} from '../packages/domain/src/index.js';

const reports: CaseIntegrityReport[] = [createSampleCase(), createHackathonCase()].map(
  validateCaseIntegrity,
);

const apiUrl = process.env.THREAD_API_URL?.trim();
if (apiUrl) {
  const response = await fetch(new URL('/api/integrity', apiUrl));
  const payload = (await response.json()) as {
    reports?: CaseIntegrityReport[];
  };
  if (!response.ok || !payload.reports) {
    throw new Error(`Live integrity endpoint failed with status ${response.status}.`);
  }
  reports.push(...payload.reports);
}

const failures = reports.flatMap((report) =>
  report.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${report.caseId}@${report.revision} ${issue.code}: ${issue.message}`),
);

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  const uniqueCases = new Set(reports.map((report) => report.caseId));
  const checkedObjects = reports.reduce(
    (total, report) => total + report.checkedObjects,
    0,
  );
  process.stdout.write(
    `THREAD integrity passed: ${uniqueCases.size} cases, ${checkedObjects} checked objects, no blocking lineage issues.\n`,
  );
}
