export default function DashboardFollowUps({ followUps = [] }) {
  return <section className="coi-card"><h2>Follow-ups due</h2>{followUps.length ? <ul className="coi-feed">{followUps.map(item => <li key={item.action_id}><b>{item.type}</b><span>{item.due_at || 'No due date'} · {item.state}</span></li>)}</ul> : <p className="coi-muted">No controlled follow-ups due.</p>}</section>;
}
