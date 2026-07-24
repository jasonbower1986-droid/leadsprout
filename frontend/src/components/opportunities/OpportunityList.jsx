import OpportunityListItem from './OpportunityListItem';
export default function OpportunityList({ opportunities }) {
  if (!opportunities.length) return <div className="coi-empty"><h2>No opportunities in this view</h2><p>Change the filter or wait for controlled opportunity analysis.</p></div>;
  return <ol className="coi-opportunity-list">{opportunities.map(item => <OpportunityListItem key={item.workspace_id} opportunity={item}/>)}</ol>;
}
