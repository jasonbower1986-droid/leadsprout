import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ContactVerification from '../components/opportunities/ContactVerification';
import EstimateDisclosure from '../components/opportunities/EstimateDisclosure';
import EvidenceAndUncertainty from '../components/opportunities/EvidenceAndUncertainty';
import OutreachTransition from '../components/opportunities/OutreachTransition';
import ProposalSummary from '../components/opportunities/ProposalSummary';
import RecommendedOffer from '../components/opportunities/RecommendedOffer';
import ReviewGate from '../components/opportunities/ReviewGate';

export default function OpportunityDetail() {
  const { workspaceId } = useParams();
  const { getHeaders } = useAuth();
  const [state, setState] = useState({
    loading: true, data: null, error: '', busy: false, notice: ''
  });

  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...getHeaders(),
        ...(options.key ? { 'Idempotency-Key': options.key } : {})
      }
    });
    const data = await response.json();
    if (!response.ok) {
      const conditions = data.unsatisfied_conditions?.length
        ? ` (${data.unsatisfied_conditions.join(', ')})` : '';
      throw new Error((data.error || 'Request failed') + conditions);
    }
    return data;
  };

  const load = () => request(`/api/opportunity-workspaces/${workspaceId}/opportunity`)
    .then(data => setState(current => ({
      ...current, loading: false, data, error: '', busy: false
    })))
    .catch(error => setState(current => ({
      ...current, loading: false, error: error.message, busy: false
    })));

  useEffect(() => { load(); }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const action = async callback => {
    setState(current => ({ ...current, busy: true, error: '', notice: '' }));
    try {
      const notice = await callback();
      await load();
      setState(current => ({ ...current, notice, busy: false }));
    } catch (error) {
      setState(current => ({ ...current, error: error.message, busy: false }));
    }
  };

  if (state.loading) {
    return <div className="coi-page" aria-busy="true"><div className="coi-skeleton tall"/></div>;
  }
  if (!state.data) {
    return <div className="coi-page"><section role="alert" className="coi-card coi-error">
      <h1>Opportunity could not be loaded</h1><p>{state.error || 'Authoritative detail is unavailable.'}</p>
    </section></div>;
  }

  const opportunity = state.data;
  const complete = opportunity.review?.valid === true;
  const decideOffer = decision => action(async () => {
    await request(`/api/opportunity-workspaces/${workspaceId}/offer`, {
      method: 'POST',
      body: JSON.stringify({
        decision, adaptation_text: null,
        rationale: 'Customer-controlled opportunity detail decision.'
      })
    });
    return 'Offer decision retained.';
  });
  const openReview = () => action(async () => {
    await request(`/api/opportunity-workspaces/${workspaceId}/review/open`, {
      method: 'POST',
      body: JSON.stringify({ candidate_snapshot_id: opportunity.candidate_snapshot_id })
    });
    await request(`/api/opportunity-workspaces/${workspaceId}/review/presentation`, {
      method: 'POST', body: '{}'
    });
    return 'Review opened.';
  });
  const acknowledge = () => action(async () => {
    await request(`/api/opportunity-workspaces/${workspaceId}/review/acknowledgement`, {
      method: 'POST',
      key: `ack-${opportunity.review.review_id}`,
      body: JSON.stringify({
        limitation_set_digest: opportunity.review.limitation_set_digest
      })
    });
    return 'Uncertainty acknowledged without changing verification.';
  });
  const completeReview = () => action(async () => {
    await request(`/api/opportunity-workspaces/${workspaceId}/review/complete`, {
      method: 'POST',
      key: `complete-${opportunity.review.review_id}`,
      body: JSON.stringify({ expected_version: opportunity.workspace_version })
    });
    return 'Review completed.';
  });
  const selectTransition = transition => action(async () => {
    const result = await request(`/api/opportunity-workspaces/${workspaceId}/start-outreach`, {
      method: 'POST',
      key: `transition-${opportunity.review.completion_id}-${transition}`,
      body: JSON.stringify({
        expected_version: opportunity.workspace_version,
        transition_type: transition
      })
    });
    return `${result.transition_type} selected. No communication was sent or recorded.`;
  });

  const businessName = opportunity.business?.business_name || 'Business identity unavailable';
  return <div className="coi-page">
    <nav aria-label="Breadcrumb" className="coi-breadcrumb">
      <Link to="/opportunities">Opportunities</Link><ChevronRight/>
      <span aria-current="page">{businessName}</span>
    </nav>
    <header className="coi-detail-header"><div><p className="coi-eyebrow">Opportunity detail</p>
      <h1>{businessName}</h1>
      <p>{opportunity.business?.domain || 'Domain unavailable'}</p></div>
      <span className="coi-confidence">{opportunity.confidence || 'Unavailable'}<small>Server-derived confidence</small></span>
    </header>
    {state.error && <div role="alert" className="coi-inline-error">{state.error}</div>}
    {state.notice && <div role="status" className="coi-inline-success">{state.notice}</div>}
    {opportunity.evidence_integrity_state === 'BLOCKED' && <section role="alert" className="coi-card coi-error">
      <h2>Evidence Integrity is blocked</h2><p>Progression and unsupported claims are withheld.</p>
    </section>}
    <div className="coi-detail-grid"><main className="coi-detail-main">
      <section className="coi-card coi-overview"><span className="coi-eyebrow">Opportunity overview</span>
        <h2>{opportunity.prioritisation_reason || 'Prioritisation reason unavailable'}</h2>
        <div className="coi-estimate-pair">
          <EstimateDisclosure title="Estimated consultant fee" estimate={opportunity.estimates?.consultant_fee}/>
          <EstimateDisclosure title="Estimated client upside" estimate={opportunity.estimates?.client_upside}/>
        </div>
      </section>
      <RecommendedOffer recommendation={opportunity.recommendation} onDecision={!complete ? decideOffer : null} busy={state.busy}/>
      <EvidenceAndUncertainty evidence={opportunity.evidence_references} basis={opportunity.decision_basis}/>
      {complete && <section className="coi-card"><h2>Governed preparation</h2>
        <p>Use only the verified evidence, recorded assumptions and visible limitations above.</p>
        <ProposalSummary workspaceId={workspaceId}/>
      </section>}
    </main><aside className="coi-detail-rail">
      <ContactVerification contact={opportunity.contact}/>
      <ReviewGate opportunity={opportunity} onReview={openReview} onAcknowledge={acknowledge} onComplete={completeReview} busy={state.busy}/>
      {complete && <OutreachTransition onSelect={selectTransition} busy={state.busy}/>}
    </aside></div>
  </div>;
}
