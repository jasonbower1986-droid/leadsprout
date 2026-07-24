export default function EstimateDisclosure({ title, estimate }) {
  const available = estimate?.state === 'ESTIMATE';
  const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: estimate?.currency || 'GBP', maximumFractionDigits: 0 }).format(value);
  return <details className="coi-card coi-disclosure">
    <summary><span>{title}</span><strong>{available ? `${money(estimate.value_low)} – ${money(estimate.value_high)}` : 'Unavailable'}</strong></summary>
    <div className="coi-disclosure-body">
      <p className="coi-muted">{estimate?.period || 'No controlled period'} · Conditional estimate, not a guarantee.</p>
      <h4>Calculation method</h4><p>{estimate?.method || 'Unavailable'}</p>
      <h4>Inputs</h4><ul>{(estimate?.inputs || []).map(item => <li key={item}>{item}</li>)}</ul>
      <h4>Assumptions</h4><ul>{(estimate?.assumptions || []).map(item => <li key={item}>{item}</li>)}</ul>
      <h4>Unavailable information</h4><ul>{(estimate?.unavailable_information || []).map(item => <li key={item}>{item}</li>)}</ul>
      <p><b>Estimated confidence:</b> {estimate?.confidence || 'UNDETERMINED'}</p>
    </div>
  </details>;
}
