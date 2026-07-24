const labels = { estimated_consultant_fee_pipeline: 'Pipeline value (estimated consultant fees)', converted_opportunities: 'Opportunities converted', average_consultant_fee: 'Average consultant fee', attributed_revenue: 'Attributed revenue' };
export default function CommercialImpactMetrics({ metrics = {} }) {
  const display = metric => metric?.state === 'UNAVAILABLE' ? 'Unavailable' : JSON.stringify(metric?.value_json ?? metric?.value ?? 'Unavailable').replaceAll('"','');
  return <section className="coi-card" aria-labelledby="impact-heading"><div className="coi-section-heading"><h2 id="impact-heading">Your commercial impact</h2><span className="coi-muted">This month</span></div><div className="coi-metric-list">{Object.entries(labels).map(([key,label]) => <div key={key} className="coi-metric-row"><div><span>{label}</span><small>Source: {metrics[key]?.source_name || 'Unavailable'}</small></div><strong>{display(metrics[key])}</strong></div>)}</div></section>;
}
