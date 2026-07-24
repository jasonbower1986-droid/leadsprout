import { CheckCircle2, LockKeyhole } from 'lucide-react';
export default function ReviewGate({ opportunity, onReview, onAcknowledge, onComplete, busy }) {
  const complete = opportunity.review?.valid;
  return <section className={`coi-card coi-review-gate ${complete ? 'complete' : ''}`} aria-live="polite">
    <div className="coi-section-heading"><div><span className="coi-eyebrow">{complete ? 'Review complete' : 'Review before outreach'}</span><h2>{complete ? 'Evidence and remaining limitations acknowledged' : 'Complete the controlled review'}</h2></div>{complete ? <CheckCircle2 aria-hidden="true"/> : <LockKeyhole aria-hidden="true"/>}</div>
    {complete ? <p>Review completed {opportunity.review.completed_at ? new Date(opportunity.review.completed_at).toLocaleString() : ''}.</p> : <p>Review evidence, estimates, assumptions, limitations and independent verification before outreach becomes available.</p>}
    {!complete && <div className="coi-actions"><button onClick={onReview} disabled={busy} className="coi-button primary">Review opportunity</button><button onClick={onAcknowledge} disabled={busy || !opportunity.review?.review_id} className="coi-button secondary">Acknowledge uncertainty</button><button onClick={onComplete} disabled={busy || !opportunity.review?.review_id} className="coi-button secondary">Complete review</button></div>}
    {!complete && <button className="coi-button locked" disabled aria-describedby="outreach-lock-reason">Start outreach</button>}
    {!complete && <p id="outreach-lock-reason" className="coi-lock-reason">Complete review first</p>}
  </section>;
}
