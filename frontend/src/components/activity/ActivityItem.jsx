import { ArrowUpRight, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

const labels = {
  WORKSPACE_VERSION_CURRENT: 'Workspace version current',
  WORKSPACE_VERSION_SUPERSEDED: 'Workspace version superseded',
  RECOMMENDATION_CHANGED: 'Recommendation changed',
  EVIDENCE_STATE_CHANGED: 'Evidence state changed',
  REVIEW_COMPLETED: 'Review completed',
  REVIEW_INVALIDATED: 'Review invalidated',
  OFFER_DECISION_RECORDED: 'Offer decision recorded',
  PREPARATION_SELECTED: 'Preparation selected',
  NEXT_ACTION_PLANNED: 'Next action planned',
  NEXT_ACTION_CHANGED: 'Next action changed',
  NEXT_ACTION_COMPLETED: 'Next action completed',
  NEXT_ACTION_CANCELLED: 'Next action cancelled',
  REPORT_AVAILABLE: 'Report available',
  REPORT_PARTIAL_EVIDENCE: 'Report has partial evidence',
  REPORT_FAILED: 'Report failed',
  REPORT_SUPERSEDED: 'Report superseded',
  EVIDENCE_INTEGRITY_BLOCKED: 'Evidence Integrity blocked',
  EVIDENCE_INTEGRITY_RESTORED: 'Evidence Integrity restored',
  COMMUNICATION_RECORDED: 'Communication recorded'
};

export default function ActivityItem({ event }) {
  const integrity = event.evidence_integrity_state === 'BLOCKED';
  const Icon = integrity ? ShieldAlert : event.actor.class === 'SYSTEM_SERVICE' ? Sparkles : CheckCircle2;
  return <li className={`act-item ${integrity ? 'is-blocked' : ''}`}>
    <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
    <span className="act-marker"><Icon size={17}/></span>
    <div className="act-event">
      <p className="act-eyebrow">{labels[event.event_category] || event.event_category}</p>
      <h2>{event.event_summary}</h2>
      <p>{event.commercial_consequence}</p>
      <div className="act-meta"><span>{event.actor.display_name} · {event.actor.class.replaceAll('_', ' ').toLowerCase()}</span>
        <span>Communication: {event.communication_status.replaceAll('_', ' ').toLowerCase()}</span>
        {event.causal_chain.state === 'PARTIAL' && <span className="act-limited">Causal detail restricted</span>}
      </div>
      {(event.correction_of_activity_event_id || event.supersedes_activity_event_id) &&
        <p className="act-lineage">This immutable entry corrects or supersedes earlier recorded history.</p>}
    </div>
    <Link to={`/activity/${encodeURIComponent(event.activity_event_id)}/affected`} aria-label={`Open affected object for ${event.event_summary}`}>Open affected object <ArrowUpRight size={15}/></Link>
  </li>;
}
