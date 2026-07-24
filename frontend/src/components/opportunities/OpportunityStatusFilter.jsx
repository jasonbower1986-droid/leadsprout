export default function OpportunityStatusFilter({ value, onChange }) {
  return <label className="coi-filter"><span>Review state</span><select value={value} onChange={event => onChange(event.target.value)}><option value="ALL">All opportunities</option><option value="UNREVIEWED">Unreviewed</option><option value="COMPLETE">Review complete</option><option value="INVALIDATED">Invalidated</option></select></label>;
}
