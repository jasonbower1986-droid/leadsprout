import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import EstimateDisclosure from '../components/opportunities/EstimateDisclosure';
import EvidenceAndUncertainty from '../components/opportunities/EvidenceAndUncertainty';
import RecommendedOffer from '../components/opportunities/RecommendedOffer';
import ContactVerification from '../components/opportunities/ContactVerification';
import ReviewGate from '../components/opportunities/ReviewGate';
import OutreachTransition from '../components/opportunities/OutreachTransition';
import ProposalSummary from '../components/opportunities/ProposalSummary';

export default function OpportunityDetail() {
  const { workspaceId } = useParams(); const { getHeaders } = useAuth();
  const [state, setState] = useState({ loading:true, data:null, error:'', busy:false, notice:'' });
  const request = async (path, options={}) => { const response = await fetch(path, { ...options, headers:{ ...getHeaders(), ...(options.key ? {'Idempotency-Key': options.key} : {}) } }); const data = await response.json(); if (!response.ok) { const suffix = data.unsatisfied_conditions?.length ? ` (${data.unsatisfied_conditions.join(', ')})` : ''; throw new Error((data.error || 'Request failed') + suffix); } return data; };
  const load = () => request(`/api/opportunity-workspaces/${workspaceId}/opportunity`).then(data => setState(value => ({...value,loading:false,data,error:'',busy:false}))).catch(error => setState(value => ({...value,loading:false,error:error.message,busy:false})));
  useEffect(load, [workspaceId]);
  const action = async callback => { setState(value => ({...value,busy:true,error:'',notice:''})); try { const notice = await callback(); await load(); setState(value => ({...value,notice:notice || '',busy:false})); } catch (error) { setState(value => ({...value,error:error.message,busy:false})); } };
  if (state.loading) return <div className="coi-page" aria-busy="true"><div className="coi-skeleton tall"/></div>;
  if (state.error && !state.data) return <div className="coi-page"><section role="alert" className="coi-card coi-error"><h1>Opportunity could not be loaded</h1><p>{state.error}</p></section></div>;
  const opportunity = state.data; const complete = opportunity.review?.valid;
  const decideOffer = decision => action(async () => { let adaptation_text = null; if (decision === 'ADAPTED') adaptation_text = window.prompt('Describe your controlled amendment.', opportunity.recommendation?.title || '') || null; await request(`/api/opportunity-workspaces/${workspaceId}/offer`, { method:'POST', body:JSON.stringify({ decision, adaptation_text, rationale:'Customer-controlled opportunity detail decision.' }) }); return 'Offer decision retained.'; });
  const openReview = () => action(async () => { await request(`/api/opportunity-workspaces/${workspaceId}/review/open`, { method:'POST', body:JSON.stringify({candidate_snapshot_id:opportunity.candidate_snapshot_id}) }); await request(`/api/opportunity-workspaces/${workspaceId}/review/presentation`, { method:'POST', body:'{}' }); return 'Review opened.'; });
  const acknowledge = () => action(async () => { await request(`/api/opportunity-workspaces/${workspaceId}/review/acknowledgement`, {method:'POST', key:`ack-${opportunity.review.review_id}`, body:JSON.stringify({limitation_set_digest:opportunity.review.limitation_set_digest})}); return 'Uncertainty acknowledged without changing verification.'; });
  const completeReview = () => action(async () => { await request(`/api/opportunity-workspaces/${workspaceId}/review/complete`, {method:'POST', key:`complete-${opportunity.review.review_id}`, body:JSON.stringify({expected_version:opportunity.workspace_version})}); return 'Review completed.'; });
  const selectTransition = transition => action(async () => { const result = await request(`/api/opportunity-workspaces/${workspaceId}/start-outreach`, {method:'POST', key:`transition-${opportunity.review.completion_id}-${transition}`, body:JSON.stringify({expected_version:opportunity.workspace_version,transition_type:transition})}); return `${result.transition_type} selected. No communication was sent or recorded.`; });
  return <div className="coi-page">
    <nav aria-label="Breadcrumb" className="coi-breadcrumb"><Link to="/dashboard">Home</Link><ChevronRight/><Link to="/opportunities">Opportunities</Link><ChevronRight/><span aria-current="page">{opportunity.business?.business_name}</span></nav>
    <header className="coi-detail-header"><div><div className="coi-title-line"><h1>{opportunity.business?.business_name}</h1><span className="coi-status success">High potential</span></div><p>{opportunity.business?.domain} · Ranked #{opportunity.rank}</p></div><span className="coi-confidence">{opportunity.confidence}<small>Opportunity confidence</small></span></header>
    {state.error && <div role="alert" className="coi-inline-error">{state.error}</div>}{state.notice && <div role="status" className="coi-inline-success">{state.notice}</div>}
    {complete && <section className="coi-review-complete"><div><b>Review completed</b><p>{opportunity.review.completed_at ? new Date(opportunity.review.completed_at).toLocaleString() : 'Completion retained.'}</p></div><p>Evidence and assumptions reviewed. Remaining limitations acknowledged.</p></section>}
    <div className="coi-detail-grid"><main className="coi-detail-main"><section className="coi-card coi-overview"><span className="coi-eyebrow">Opportunity overview</span><h2>{opportunity.prioritisation_reason || 'High-potential commercial opportunity'}</h2><p>Confidence in the current evidence and controlled recommendation: <b>{opportunity.confidence}</b>.</p><div className="coi-estimate-pair"><EstimateDisclosure title="Estimated consultant fee" estimate={opportunity.estimates?.consultant_fee}/><EstimateDisclosure title="Estimated client upside" estimate={opportunity.estimates?.client_upside}/></div></section><RecommendedOffer recommendation={opportunity.recommendation} onDecision={!complete ? decideOffer : null} busy={state.busy}/><EvidenceAndUncertainty evidence={opportunity.evidence_references} basis={opportunity.decision_basis}/>{complete && <section className="coi-card"><h2>Evidence-based talking points</h2><ul><li>Lead with the observed condition, not a guaranteed outcome.</li><li>Explain the controlled recommendation and remaining limitations.</li><li>Confirm the appropriate decision-maker before proposing delivery.</li></ul><ProposalSummary workspaceId={workspaceId}/></section>}</main><aside className="coi-detail-rail"><ContactVerification contact={opportunity.contact}/><ReviewGate opportunity={opportunity} onReview={openReview} onAcknowledge={acknowledge} onComplete={completeReview} busy={state.busy}/>{complete && <OutreachTransition onSelect={selectTransition} busy={state.busy}/>}</aside></div>
  </div>;
}
