const LABELS = {
  AVAILABLE: 'Available', PARTIAL_EVIDENCE: 'Partial evidence', STALE: 'Stale',
  SUPERSEDED: 'Superseded', FAILED: 'Failed', UNAVAILABLE: 'Unavailable',
  GENERATING: 'Processing', RESTRICTED: 'Restricted',
  INTEGRITY_BLOCKED: 'Evidence Integrity blocked'
};

export function ReportState({ state, current }) {
  return <span className={`rpt-state rpt-state-${String(state).toLowerCase()}`}>
    {current && ['AVAILABLE', 'PARTIAL_EVIDENCE'].includes(state) ? 'Current · ' : ''}
    {LABELS[state] || 'Unavailable'}
  </span>;
}

export function ReportUnavailable({ state = 'UNAVAILABLE', title, detail }) {
  return <section className="rpt-empty" role={state === 'FAILED' ? 'alert' : 'status'}>
    <ReportState state={state}/>
    <h2>{title || 'No current report is available'}</h2>
    <p>{detail || 'Existing authorised history will appear here when available. No processing or failure is implied.'}</p>
  </section>;
}
