import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Bell, BriefcaseBusiness, Building2, Check, Clock3,
  FileText, Info, LockKeyhole, MapPin, Search, Sparkles, Star, Target, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const unavailable = 'Unavailable';
const present = value => value === null || value === undefined || value === '' ? unavailable : value;
const money = estimate => {
  if (!estimate || estimate.state === 'UNAVAILABLE' || estimate.value_low == null || estimate.value_high == null) return unavailable;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: estimate.currency || 'GBP', maximumFractionDigits: 0,
  }).formatRange(estimate.value_low, estimate.value_high);
};
const metricValue = metric => {
  if (!metric || metric.state === 'UNAVAILABLE' || metric.value == null) return unavailable;
  if (typeof metric.value === 'number' && metric.currency) return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: metric.currency, maximumFractionDigits: 0,
  }).format(metric.value);
  return metric.value;
};
const trendValue = trend => trend == null ? unavailable : `${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend)}%`;

function UnavailableButton({ children, className = '' }) {
  return <button className={className} type="button" disabled title="This destination is not yet available">{children}</button>;
}

function Portfolio({ opportunities = [], portfolio = {}, upgrade = {} }) {
  const tabs = [
    { id: 'priority', label: 'Priority', count: portfolio.priority, rows: opportunities.filter(item => item.priority) },
    { id: 'all', label: 'All Opportunities', count: portfolio.total, rows: opportunities },
    { id: 'monitored', label: 'Monitored', count: portfolio.monitored, rows: opportunities.filter(item => item.monitored) },
  ];
  const [selected, setSelected] = useState('priority');
  const tabRefs = useRef([]);
  const active = tabs.find(tab => tab.id === selected) || tabs[0];
  const moveTab = (event, index) => {
    const keys = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (keys[event.key] == null) return;
    event.preventDefault();
    const next = keys[event.key];
    setSelected(tabs[next].id);
    tabRefs.current[next]?.focus();
  };
  return <section className="home-card home-portfolio" aria-labelledby="portfolio-title">
    <h2 id="portfolio-title">Your opportunities</h2>
    <div className="home-tabs" role="tablist" aria-label="Opportunity portfolio views">
      {tabs.map((tab, index) => <button key={tab.id} ref={node => { tabRefs.current[index] = node; }} type="button"
        id={`portfolio-tab-${tab.id}`} role="tab" aria-selected={selected === tab.id}
        aria-controls="portfolio-panel" tabIndex={selected === tab.id ? 0 : -1}
        className={selected === tab.id ? 'active' : ''} onClick={() => setSelected(tab.id)}
        onKeyDown={event => moveTab(event, index)}>{tab.label} ({present(tab.count)})</button>)}
    </div>
    <div id="portfolio-panel" role="tabpanel" aria-labelledby={`portfolio-tab-${active.id}`} tabIndex="0">
      {active.rows.length ? <table className="home-opportunity-table">
        <thead><tr><th scope="col">Rank</th><th scope="col">Business</th><th scope="col">Opportunity confidence</th><th scope="col">Recommended offer</th></tr></thead>
        <tbody>{active.rows.map(item => <tr key={item.workspace_id}>
          <td data-label="Rank"><span className="home-rank">{present(item.rank)}</span></td>
          <td data-label="Business"><div className="home-business-cell"><div className={`home-business-icon ${item.category || ''}`} aria-hidden="true">{item.category === 'fitness' ? <BriefcaseBusiness/> : item.category === 'trend' ? <TrendingUp/> : '♧'}</div><div><strong>{present(item.business?.business_name)}</strong><small>{present(item.location)}</small></div></div></td>
          <td data-label="Opportunity confidence"><div className="home-confidence"><strong>{item.confidence_score == null ? unavailable : `${item.confidence_score}%`}</strong><span aria-hidden="true">{[0,1,2,3,4].map(dot => <i key={dot} className={dot < Math.round((item.confidence_score || 0) / 20) ? 'on' : ''}/>)}</span><small className={item.confidence_class === 'MEDIUM' ? 'medium' : ''}>{present(item.confidence_class)}</small></div></td>
          <td data-label="Recommended offer"><Link to={`/opportunities/${item.workspace_id}`}>{present(item.recommended_offer?.title || item.recommended_offer)}</Link></td>
        </tr>)}</tbody>
      </table> : <p className="home-empty-state">No controlled records are available in this view.</p>}
    </div>
    <div className="home-upgrade"><div className="home-lock"><LockKeyhole/></div><div><strong>{present(upgrade.locked_count)}</strong><b> additional high-potential opportunities</b><small>{present(upgrade.description)}</small></div><ul><li><Check/> Full commercial analysis</li><li><Check/> Revenue estimates</li><li><Check/> Outreach recommendations</li><li><Check/> Proposal generation</li></ul><UnavailableButton>Upgrade unavailable <ArrowRight/></UnavailableButton></div>
  </section>;
}

function EstimatePanel({ opportunity, open, onClose, closeRef }) {
  if (!open) return null;
  const disclosure = opportunity.estimate_disclosure || {};
  return <aside id="estimate-disclosure" className="home-estimate-popover" role="dialog" aria-modal="false" aria-labelledby="estimate-title">
    <div className="popover-title"><strong id="estimate-title">Estimated Client Upside</strong><button ref={closeRef} type="button" onClick={onClose} aria-label="Close estimate details">×</button></div>
    <div className="popover-section"><b>Estimate</b><strong>{money(opportunity.estimates?.client_upside)} annual revenue opportunity</strong></div>
    <div className="popover-section"><b>Calculated from <Info/></b>{(disclosure.calculated_from || []).map(item => <span key={item}><Check/> {item}</span>)}{!disclosure.calculated_from?.length && <span>{unavailable}</span>}</div>
    <div className="popover-section"><b>Assumptions</b>{disclosure.assumptions?.length ? <ul>{disclosure.assumptions.map(item => <li key={item}>{item}</li>)}</ul> : <span>{unavailable}</span>}</div>
    <div className="popover-section"><b>Unavailable Information</b>{disclosure.unavailable_information?.length ? <ul>{disclosure.unavailable_information.map(item => <li key={item}>{item}</li>)}</ul> : <span>{unavailable}</span>}</div>
    <div className="popover-confidence"><b>Estimated Confidence</b><span>{present(disclosure.confidence)}</span></div>
    <p>{present(disclosure.disclaimer)}</p>
  </aside>;
}

function AtAGlance({ data = {}, period }) {
  const items = [
    [Search, data.businesses_analysed, 'Businesses analysed', data.businesses_analysed_trend],
    [Target, data.new_opportunities, 'New opportunities', data.new_opportunities_trend],
    [TrendingUp, data.priority_changes, 'Priority changes', data.priority_changes_trend],
    [Clock3, data.follow_ups_due, 'Follow-ups due', data.follow_ups_due_label],
  ];
  return <section className="home-card home-glance"><div className="home-card-head"><h2>At a glance</h2><span>{present(period)}</span></div><div className="home-glance-grid">{items.map(([Icon,value,label,trend],index) => <div key={label}><Icon/><strong>{present(value)}</strong><span>{label}</span><small className={index === 3 ? 'due' : ''}>{index === 3 ? present(trend) : trendValue(trend)}</small></div>)}</div><UnavailableButton className="home-text-control">View all insights <ArrowRight/></UnavailableButton></section>;
}

function Impact({ metrics = {}, period }) {
  const items = [
    [BriefcaseBusiness, 'Pipeline value (est. consultant fees)', metrics.estimated_consultant_fee_pipeline],
    [FileText, 'Opportunities converted', metrics.converted_opportunities],
    [Target, 'Avg. consultant fee per engagement', metrics.average_consultant_fee],
    [BarChart3, 'Revenue (HubSpot)', metrics.attributed_revenue],
  ];
  return <section className="home-card home-impact"><div className="home-card-head"><h2>Your commercial impact</h2><span>{present(period)}</span></div>{items.map(([Icon,label,metric]) => <div className="home-impact-row" key={label}><Icon/><span>{label}</span><strong>{metricValue(metric)}</strong><b>{trendValue(metric?.trend_percent)}</b></div>)}<UnavailableButton className="home-text-control">View full report <ArrowRight/></UnavailableButton></section>;
}

function Momentum({ momentum = {}, period }) {
  const points = Array.isArray(momentum.points) ? momentum.points.filter(point => typeof point?.value === 'number') : [];
  const max = Math.max(...points.map(point => point.value), 1);
  const coords = points.map((point,index) => `${22 + index * (288 / Math.max(points.length - 1, 1))},${132 - (point.value / max) * 108}`);
  return <section className="home-card home-momentum"><div className="home-card-head"><h2>Your momentum</h2><span>{present(period)}</span></div><small>{present(momentum.label)}</small>
    {points.length ? <><svg viewBox="0 0 320 150" role="img" aria-label={present(momentum.summary)}><g>{[20,45,70,95,120].map(y => <line key={y} x1="22" y1={y} x2="310" y2={y}/>)}</g><polyline points={coords.join(' ')}/>{coords.map((coordinate,index) => { const [cx,cy] = coordinate.split(','); return <circle key={points[index].label || index} cx={cx} cy={cy} r="3"/>; })}</svg><div className="home-chart-dates">{points.map(point => <span key={point.label}>{present(point.label)}</span>)}</div><p className="sr-only">{points.map(point => `${present(point.label)}: ${present(point.display_value || point.value)}`).join('; ')}</p></> : <p className="home-empty-state">Momentum data unavailable.</p>}
    <strong>{present(momentum.headline)}</strong><p>{present(momentum.message)}</p><UnavailableButton className="home-text-control">How it works <ArrowRight/></UnavailableButton>
  </section>;
}

function ActivityPanels({ activity = [], followups = [] }) {
  const icons = { opportunity: Star, movement: TrendingUp, proposal: FileText, expansion: BarChart3, follow_up: Bell };
  return <div className="home-two-up"><section className="home-card home-activity"><div className="home-card-head"><h2>Recent activity</h2><UnavailableButton className="home-text-control">View all activity <ArrowRight/></UnavailableButton></div>{activity.length ? activity.map((item,index) => { const Icon = icons[item.type] || Bell; return <div className="home-feed-row" key={`${item.title}-${index}`}><Icon/><div><strong>{present(item.title)}</strong><span>{present(item.subject)}</span></div><small>{present(item.time_label)}</small><i/></div>; }) : <p className="home-empty-state">Activity unavailable.</p>}</section>
    <section className="home-card home-followups"><div className="home-card-head"><h2>Follow-ups due</h2><UnavailableButton className="home-text-control">View calendar <ArrowRight/></UnavailableButton></div>{followups.length ? followups.map((item,index) => <div className="home-follow-row" key={`${item.name}-${index}`}><div><small>{present(item.month)}</small><b>{present(item.day)}</b></div><p><strong>{present(item.name)}</strong><span>{present(item.type)}</span><em>{present(item.due_label)}</em></p><UnavailableButton>Open</UnavailableButton></div>) : <p className="home-empty-state">Follow-ups unavailable.</p>}</section></div>;
}

export default function Dashboard() {
  const { getHeaders, features } = useAuth();
  const [state,setState] = useState({loading:true,data:null,error:''});
  const [estimateOpen, setEstimateOpen] = useState(false);
  const disclosureButton = useRef(null);
  const disclosureClose = useRef(null);
  useEffect(() => {
    if (!features.opportunity_workspace) return;
    fetch('/api/opportunity-workspaces/dashboard',{headers:getHeaders()}).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error || 'Dashboard unavailable');
      return response.json();
    }).then(data => setState({loading:false,data,error:''})).catch(error => setState({loading:false,data:null,error:error.message}));
  },[features.opportunity_workspace, getHeaders]);
  useEffect(() => {
    if (!estimateOpen) return undefined;
    disclosureClose.current?.focus();
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      setEstimateOpen(false);
      requestAnimationFrame(() => disclosureButton.current?.focus());
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [estimateOpen]);
  if (!features.opportunity_workspace) return <div className="coi-page"><section className="coi-card coi-empty"><h1>Home</h1><p>Commercial opportunities are not available.</p></section></div>;
  if (state.loading) return <div className="coi-page" aria-busy="true"><div className="coi-skeleton tall"/></div>;
  if (state.error) return <div className="coi-page"><section role="alert" className="coi-card coi-error"><h1>Home could not be loaded</h1><p>{state.error}</p></section></div>;
  const data = state.data;
  const opportunity = data.strongest_opportunity;
  if (!opportunity) return <div className="coi-page"><section className="coi-card coi-empty"><h1>Home</h1><p>No controlled opportunities are available.</p></section></div>;
  const closeEstimate = () => {
    setEstimateOpen(false);
    requestAnimationFrame(() => disclosureButton.current?.focus());
  };
  return <div className="home-dashboard"><div className="home-grid"><div className="home-primary">
    <section className="home-card home-hero"><div className="home-hero-main"><span className="home-kicker">Top opportunity</span><div className="home-identity"><div className="home-tooth" aria-hidden="true">♧</div><div><h2>{present(opportunity.business?.business_name)}</h2><p><MapPin/> {present(opportunity.location)} <span/><Building2/> {present(opportunity.business?.domain)}</p></div></div><span className="home-potential"><Star/> {present(opportunity.potential_label)}</span><p className="home-summary">{present(opportunity.prioritisation_reason)}{opportunity.summary_detail && <><br/>{opportunity.summary_detail}</>}</p><div className="home-actions"><Link to={`/opportunities/${opportunity.workspace_id}`}>Review opportunity <ArrowRight/></Link>{opportunity.outreach_eligible ? <Link className="secondary" to={`/opportunities/${opportunity.workspace_id}`}>Start outreach <ArrowRight/></Link> : <button disabled>Start outreach <LockKeyhole/></button>}</div>{!opportunity.outreach_eligible && <small>Complete review first</small>}</div>
      <div className="home-hero-estimates"><label>Estimated consultant fee</label><strong>{money(opportunity.estimates?.consultant_fee)}</strong><span>One-off project</span><label>Estimated client upside <button ref={disclosureButton} type="button" className="home-info-button" aria-label="Show estimated client upside details" aria-expanded={estimateOpen} aria-controls="estimate-disclosure" onClick={() => setEstimateOpen(value => !value)}><Info/></button></label><strong>{money(opportunity.estimates?.client_upside)}</strong><span>Annual revenue opportunity</span></div>
      <EstimatePanel opportunity={opportunity} open={estimateOpen} onClose={closeEstimate} closeRef={disclosureClose}/></section>
    <Portfolio opportunities={data.opportunities} portfolio={data.portfolio} upgrade={data.upgrade}/><ActivityPanels activity={data.activity} followups={data.follow_ups}/></div>
    <aside className="home-rail"><AtAGlance data={data.at_a_glance} period={data.period?.label}/><Impact metrics={data.metrics} period={data.period?.label}/><Momentum momentum={data.momentum} period={data.period?.label}/></aside></div>
    <section className="home-intelligence"><div><Sparkles/></div><p><strong>{present(data.intelligence_explanation?.headline)}</strong><span>{present(data.intelligence_explanation?.detail)}</span></p><UnavailableButton>See how it works <ArrowRight/></UnavailableButton></section><footer>© SaiphLab Ltd. All rights reserved.</footer>
  </div>;
}
