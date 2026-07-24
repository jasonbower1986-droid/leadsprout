import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import OpportunityPriorityHero from '../components/dashboard/OpportunityPriorityHero';
import CommercialImpactMetrics from '../components/dashboard/CommercialImpactMetrics';
import DashboardInsights from '../components/dashboard/DashboardInsights';
import DashboardActivity from '../components/dashboard/DashboardActivity';
import DashboardFollowUps from '../components/dashboard/DashboardFollowUps';
import DashboardMomentum from '../components/dashboard/DashboardMomentum';

export default function Dashboard() {
  const { getHeaders, features } = useAuth();
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  useEffect(() => {
    if (!features.opportunity_workspace) return;
    fetch('/api/opportunity-workspaces/dashboard', { headers: getHeaders() }).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error || 'Dashboard unavailable');
      return response.json();
    }).then(data => setState({ loading: false, data, error: '' })).catch(error => setState({ loading: false, data: null, error: error.message }));
  }, [features.opportunity_workspace]);
  if (!features.opportunity_workspace) return <div className="coi-page"><section className="coi-card coi-empty"><h1>Home</h1><p>Commercial opportunities are not available.</p></section></div>;
  if (state.loading) return <div className="coi-page" aria-busy="true"><div className="coi-skeleton tall"/><div className="coi-skeleton"/></div>;
  if (state.error) return <div className="coi-page"><section role="alert" className="coi-card coi-error"><h1>Home could not be loaded</h1><p>{state.error}</p></section></div>;
  const data = state.data;
  return <div className="coi-page">
    <header className="coi-page-header"><div><p className="coi-eyebrow">Commercial opportunity intelligence</p><h1>Good morning.</h1><p>Review the strongest current opportunity and your wider commercial portfolio.</p></div><Link to="/opportunities" className="coi-button secondary">View all opportunities <ArrowRight size={18}/></Link></header>
    <div className="coi-dashboard-grid"><div className="coi-dashboard-main"><OpportunityPriorityHero opportunity={data.strongest_opportunity}/><section className="coi-card"><div className="coi-section-heading"><h2>Your opportunities</h2><Link to="/opportunities">View portfolio <ArrowRight size={16}/></Link></div>{data.strongest_opportunity ? <p><b>Priority opportunity:</b> {data.strongest_opportunity.business?.business_name}. Review state: {data.strongest_opportunity.review?.status}.</p> : <p className="coi-muted">No current opportunities.</p>}</section><div className="coi-dashboard-split"><DashboardActivity activity={data.activity}/><DashboardFollowUps followUps={data.follow_ups}/></div></div><aside className="coi-dashboard-rail"><DashboardInsights portfolio={data.portfolio} insights={data.insights}/><CommercialImpactMetrics metrics={data.metrics}/><DashboardMomentum momentum={data.momentum}/></aside></div>
  </div>;
}
