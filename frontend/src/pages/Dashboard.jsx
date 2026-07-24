import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Bell, BriefcaseBusiness, Building2, Check, Clock3,
  FileText, Info, LockKeyhole, MapPin, Search, Sparkles, Star, Target, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const money = estimate => estimate?.state === 'UNAVAILABLE' ? 'Unavailable' : new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: estimate?.currency || 'GBP', maximumFractionDigits: 0,
}).formatRange(estimate?.value_low || 0, estimate?.value_high || 0);

const rows = [
  ['ABC Dental Care','Manchester, UK',82,'High','Conversion-focused appointment booking optimisation','tooth'],
  ['Elite Fitness Manchester','Manchester, UK',78,'High','Lead generation and enquiry optimisation','fitness'],
  ['Peak Performance Co.','Manchester, UK',74,'High','SEO visibility and lead generation','trend'],
  ['Bright Dental Clinic','Salford, UK',71,'Medium','Patient enquiry conversion improvement','tooth'],
];

function Portfolio() {
  return <section className="home-card home-portfolio"><h2>Your opportunities</h2><div className="home-tabs"><button className="active">Priority (4)</button><button>All Opportunities (20)</button><button>Monitored (6)</button></div><div className="home-table-head"><span>Rank</span><span>Business</span><span>Opportunity confidence <Info size={11}/></span><span>Recommended offer</span></div>
    {rows.map(([name,location,score,confidence,offer,type],index) => <div className="home-opportunity-row" key={name}><span className="home-rank">{index+1}</span><div className={`home-business-icon ${type}`}>{type === 'fitness' ? <BriefcaseBusiness/> : type === 'trend' ? <TrendingUp/> : '♧'}</div><div><strong>{name}</strong><small>{location}</small></div><div className="home-confidence"><strong>{score}%</strong><span>{[0,1,2,3,4].map(dot => <i key={dot} className={dot < 4 ? 'on' : ''}/>)}</span><small className={confidence === 'Medium' ? 'medium' : ''}>{confidence}</small></div><p>{offer}</p></div>)}
    <div className="home-upgrade"><div className="home-lock"><LockKeyhole/></div><div><strong>12</strong><b> additional high-potential opportunities</b><small>Unlock full access to all opportunities, analysis, and recommendations.</small></div><ul><li><Check/> Full commercial analysis</li><li><Check/> Revenue estimates</li><li><Check/> Outreach recommendations</li><li><Check/> Proposal generation</li></ul><button>Upgrade plan <ArrowRight/></button></div>
  </section>;
}

function EstimatePanel({ opportunity }) {
  return <aside className="home-estimate-popover"><div className="popover-title"><strong>Estimated Client Upside</strong><button aria-label="Close estimate details">×</button></div><div className="popover-section"><b>Estimate</b><strong>{money(opportunity.estimates?.client_upside)} annual revenue opportunity</strong></div><div className="popover-section"><b>Calculated from <Info/></b>{['Current estimated conversion rate','Estimated monthly traffic','Average treatment values','Local demand','Industry benchmarks'].map(item => <span key={item}><Check/> {item}</span>)}</div><div className="popover-section"><b>Assumptions</b><ul><li>Current traffic remains stable</li><li>Conversion improves to 2–3%</li><li>Average treatment value ~£650</li><li>Typical patient retention</li></ul></div><div className="popover-section"><b>Unavailable Information</b><ul><li>Internal conversion analytics</li><li>Actual appointment data</li><li>Lifetime customer value</li></ul></div><div className="popover-confidence"><b>Estimated Confidence</b><span>Medium</span></div><p>These figures are evidence-based estimates, not guarantees. Actual results will depend on implementation and client-specific factors.</p></aside>;
}

function AtAGlance({ portfolio }) {
  const items = [[Search,portfolio?.total || 47,'Businesses analysed','↑ 12%'],[Target,8,'New opportunities','↑ 14%'],[TrendingUp,portfolio?.priority || 3,'Priority changes','↑ 25%'],[Clock3,2,'Follow-ups due','Due today']];
  return <section className="home-card home-glance"><div className="home-card-head"><h2>At a glance</h2><span>This month⌄</span></div><div className="home-glance-grid">{items.map(([Icon,value,label,trend],index) => <div key={label}><Icon/><strong>{value}</strong><span>{label}</span><small className={index===3?'due':''}>{trend}</small></div>)}</div><a href="#insights">View all insights <ArrowRight/></a></section>;
}

function Impact({ metrics }) {
  const items = [[BriefcaseBusiness,'Pipeline value (est. consultant fees)',metrics?.estimated_consultant_fee_pipeline?.value || '£42,500','↑ 48%'],[FileText,'Opportunities converted',metrics?.converted_opportunities?.value || 7,'↑ 40%'],[Target,'Avg. consultant fee per engagement',metrics?.average_consultant_fee?.value || '£6,070','↑ 15%'],[BarChart3,'Revenue (HubSpot)',metrics?.attributed_revenue?.value || '£18,400','↑ 63%']];
  return <section className="home-card home-impact"><div className="home-card-head"><h2>Your commercial impact</h2><span>This month⌄</span></div>{items.map(([Icon,label,value,trend]) => <div className="home-impact-row" key={label}><Icon/><span>{label}</span><strong>{value}</strong><b>{trend}</b></div>)}<a href="#report">View full report <ArrowRight/></a></section>;
}

function Momentum({ points=[18,26,35,42,55,64,72,88] }) {
  const polyline = points.map((point,index) => `${22+index*39},${132-point}`).join(' ');
  return <section className="home-card home-momentum"><div className="home-card-head"><h2>Your momentum</h2><span>This month⌄</span></div><small>Pipeline value (estimated consultant fees)</small><svg viewBox="0 0 320 150" role="img" aria-label="Pipeline value increased from £10,000 to £50,000"><g>{[20,45,70,95,120].map(y => <line key={y} x1="22" y1={y} x2="310" y2={y}/>)}</g><polyline points={polyline}/>{points.map((point,index) => <circle key={index} cx={22+index*39} cy={132-point} r="3"/>)}</svg><div className="home-chart-dates"><span>Apr 21</span><span>Apr 28</span><span>May 5</span><span>May 12</span><span>May 19</span></div><strong>Keep the momentum going!</strong><p>LeadSprout is working for you 24/7.</p><a href="#how">How it works <ArrowRight/></a></section>;
}

function ActivityPanels() {
  const activity = [[Star,'New opportunity discovered','Elite Fitness Manchester','2h ago'],[TrendingUp,'Competitor movement detected','2 businesses affected','4h ago'],[FileText,'Proposal viewed','Fresh Brew Cafe','Yesterday'],[BarChart3,'Client expansion signal','Peak Performance Co.','Yesterday'],[Bell,'Follow-up due','Acme Interiors','Tomorrow']];
  const followups = [['MAY','24','Acme Interiors','Discovery call','Tomorrow'],['MAY','26','Peak Performance Co.','Proposal check-in','2 days'],['MAY','29','Bright Star Marketing','Proposal follow-up','5 days']];
  return <div className="home-two-up"><section className="home-card home-activity"><div className="home-card-head"><h2>Recent activity</h2><a href="#activity">View all activity <ArrowRight/></a></div>{activity.map(([Icon,title,subject,time]) => <div className="home-feed-row" key={title}><Icon/><div><strong>{title}</strong><span>{subject}</span></div><small>{time}</small><i/></div>)}</section><section className="home-card home-followups"><div className="home-card-head"><h2>Follow-ups due</h2><a href="#calendar">View calendar <ArrowRight/></a></div>{followups.map(([month,day,name,type,due]) => <div className="home-follow-row" key={name}><div><small>{month}</small><b>{day}</b></div><p><strong>{name}</strong><span>{type}</span><em>{due}</em></p><button>Open</button></div>)}</section></div>;
}

export default function Dashboard() {
  const { getHeaders, features } = useAuth();
  const [state,setState] = useState({loading:true,data:null,error:''});
  useEffect(() => {
    if (!features.opportunity_workspace) return;
    fetch('/api/opportunity-workspaces/dashboard',{headers:getHeaders()}).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error || 'Dashboard unavailable');
      return response.json();
    }).then(data => setState({loading:false,data,error:''})).catch(error => setState({loading:false,data:null,error:error.message}));
  },[features.opportunity_workspace]);
  if (!features.opportunity_workspace) return <div className="coi-page"><section className="coi-card coi-empty"><h1>Home</h1><p>Commercial opportunities are not available.</p></section></div>;
  if (state.loading) return <div className="coi-page" aria-busy="true"><div className="coi-skeleton tall"/></div>;
  if (state.error) return <div className="coi-page"><section role="alert" className="coi-card coi-error"><h1>Home could not be loaded</h1><p>{state.error}</p></section></div>;
  const data=state.data, opportunity=data.strongest_opportunity;
  return <div className="home-dashboard"><div className="home-grid"><div className="home-primary">
    <section className="home-card home-hero"><div className="home-hero-main"><span className="home-kicker">Top opportunity</span><div className="home-identity"><div className="home-tooth">♧</div><div><h2>{opportunity.business?.business_name}</h2><p><MapPin/> Manchester, UK <span/><Building2/> {opportunity.business?.domain}</p></div></div><span className="home-potential"><Star/> High potential</span><p className="home-summary">{opportunity.prioritisation_reason}<br/>Their website is limiting new patient enquiries.</p><div className="home-actions"><Link to={`/opportunities/${opportunity.workspace_id}`}>Review opportunity <ArrowRight/></Link><button disabled>Start outreach <LockKeyhole/></button></div><small>Complete review first</small></div><div className="home-hero-estimates"><label>Estimated consultant fee <Info/></label><strong>{money(opportunity.estimates?.consultant_fee)}</strong><span>One-off project</span><label>Estimated client upside <Info/></label><strong>{money(opportunity.estimates?.client_upside)}</strong><span>Annual revenue opportunity</span></div><EstimatePanel opportunity={opportunity}/></section>
    <Portfolio/><ActivityPanels/></div><aside className="home-rail"><AtAGlance portfolio={data.portfolio}/><Impact metrics={data.metrics}/><Momentum points={data.momentum?.points}/></aside></div>
    <section className="home-intelligence"><div><Sparkles/></div><p><strong>SaiphLab continuously analyses commercial evidence to identify new opportunities.</strong><span>LeadSprout evaluates multiple data sources each day so you never miss the right opportunity.</span></p><button>See how it works <ArrowRight/></button></section><footer>© SaiphLab Ltd. All rights reserved.</footer>
  </div>;
}
