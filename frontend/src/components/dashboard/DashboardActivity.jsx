export default function DashboardActivity({ activity = [] }) {
  return <section className="coi-card"><h2>Recent activity</h2>{activity.length ? <ul className="coi-feed">{activity.map((item,index) => <li key={`${item.workspace_id}-${index}`}>{item.text}</li>)}</ul> : <p className="coi-muted">No controlled activity available.</p>}</section>;
}
