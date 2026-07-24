import { Link } from 'react-router-dom';
import { ArrowRight, LockKeyhole, Star } from 'lucide-react';
import EstimateDisclosure from '../opportunities/EstimateDisclosure';
export default function OpportunityPriorityHero({ opportunity }) {
  if (!opportunity) return <section className="coi-card coi-empty"><h2>No current opportunity</h2><p>Controlled commercial analysis has not produced an eligible opportunity.</p></section>;
  return <section className="coi-card coi-priority-hero" aria-labelledby="priority-heading">
    <div className="coi-section-heading"><div><span className="coi-eyebrow">Top opportunity</span><h2 id="priority-heading">{opportunity.business?.business_name}</h2><p>{opportunity.business?.domain}</p></div><span className="coi-status success"><Star size={15}/> High potential</span></div>
    <p className="coi-hero-copy">{opportunity.prioritisation_reason || 'High-impact opportunity requiring controlled review.'}</p>
    <div className="coi-estimate-pair"><EstimateDisclosure title="Estimated consultant fee" estimate={opportunity.estimates?.consultant_fee}/><EstimateDisclosure title="Estimated client upside" estimate={opportunity.estimates?.client_upside}/></div>
    <div className="coi-actions"><Link className="coi-button primary" to={`/opportunities/${opportunity.workspace_id}`}>Review opportunity <ArrowRight size={18}/></Link><button className="coi-button locked" disabled><span>Start outreach</span><LockKeyhole size={16}/></button></div>
    {!opportunity.outreach_eligible && <p className="coi-lock-reason">Complete review first</p>}
  </section>;
}
