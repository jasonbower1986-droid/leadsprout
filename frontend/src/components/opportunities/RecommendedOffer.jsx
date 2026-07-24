import { Sparkles } from 'lucide-react';

export default function RecommendedOffer({ recommendation, onDecision, busy }) {
  if (!recommendation) return <section className="coi-card"><h2>Recommended offer unavailable</h2><p className="coi-muted">A controlled recommendation has not been recorded.</p></section>;
  return <section className="coi-card coi-offer" aria-labelledby="offer-heading">
    <div className="coi-section-heading"><div><span className="coi-eyebrow"><Sparkles size={16}/> SaiphLab recommended offer</span><h2 id="offer-heading">{recommendation.adaptation_text || recommendation.title}</h2></div><span className="coi-status success">{recommendation.decision || 'Recommended'}</span></div>
    <p>{recommendation.problem_fit}</p><p className="coi-muted">{recommendation.outcome}</p>
    {onDecision && <div className="coi-actions"><button disabled={busy} onClick={() => onDecision('ACCEPTED')} className="coi-button secondary">Confirm offer</button><button disabled={busy} onClick={() => onDecision('ADAPTED')} className="coi-button ghost">Amend offer</button></div>}
  </section>;
}
