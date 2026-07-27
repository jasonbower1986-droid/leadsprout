const LABELS = {
  verified_observation_count: 'Verified observations',
  bounded_inference_count: 'Bounded inferences',
  material_limitation_count: 'Material limitations',
  contradiction_count: 'Contradictions',
  unavailable_information_count: 'Unavailable information'
};

export default function EvidenceComposition({ composition }) {
  return <section className="rpt-card" aria-labelledby="evidence-composition-title">
    <p className="rpt-kicker">Inspectable evidence</p>
    <h2 id="evidence-composition-title">Evidence composition</h2>
    <dl className="rpt-composition">{Object.entries(LABELS).map(([key, label]) =>
      <div key={key}><dt>{label}</dt><dd>{composition?.[key] ?? 'Unavailable'}</dd></div>
    )}</dl>
    {composition?.entries?.length ? <ul className="rpt-evidence-list">
      {composition.entries.map(item => <li key={`${item.evidence_id}-${item.evidence_classification}`}>
        <strong>{item.evidence_classification.replaceAll('_', ' ')}</strong>
        <span>{item.provenance_reference}</span>
      </li>)}
    </ul> : <p className="rpt-muted">Inspectable entries are unavailable.</p>}
  </section>;
}
