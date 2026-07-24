export default function EvidenceAndUncertainty({ evidence = [], basis = {} }) {
  return <section className="coi-card" aria-labelledby="evidence-heading">
    <div className="coi-section-heading"><div><span className="coi-eyebrow">Evidence control</span><h2 id="evidence-heading">Evidence and uncertainty</h2></div><span className="coi-count">{evidence.length} references</span></div>
    <div className="coi-evidence-grid">
      <div><h3>Supporting evidence</h3>{evidence.length ? evidence.map(reference => <a className="coi-evidence-link" key={reference.reference_id} href={`#evidence-${encodeURIComponent(reference.reference_id)}`}>{reference.source_type}: {reference.reference_id}</a>) : <p className="coi-muted">No supporting evidence is available.</p>}</div>
      <div><h3>Assumptions</h3><ul>{(basis.assumptions || []).map(item => <li key={item}>{item}</li>)}</ul><h3>Unavailable information</h3><ul>{(basis.unavailable_information || []).map(item => <li key={item}>{item}</li>)}</ul></div>
      <div><h3>Contradictions and limitations</h3><ul>{[...(basis.contradictions || []), ...(basis.material_limitations || [])].map(item => <li key={item}>{item}</li>)}</ul>{!(basis.contradictions?.length || basis.material_limitations?.length) && <p className="coi-muted">No additional material limitation recorded.</p>}</div>
    </div>
  </section>;
}
