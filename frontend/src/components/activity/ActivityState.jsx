export function ActivityState({ state, retry }) {
  if (state === 'loading') return <section className="act-state" aria-live="polite" aria-busy="true"><span className="act-skeleton"/>Loading governed activity…</section>;
  if (state === 'empty') return <section className="act-state"><strong>No material activity recorded</strong><p>Internal processing, page views, retries and diagnostics are not shown here.</p></section>;
  return <section className="act-state act-error" role="alert"><strong>Activity is unavailable</strong><p>Prior history has not been replaced or broadened.</p><button type="button" onClick={retry}>Try again</button></section>;
}
