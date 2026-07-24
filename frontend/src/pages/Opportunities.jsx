import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import OpportunityList from '../components/opportunities/OpportunityList';
import OpportunityStatusFilter from '../components/opportunities/OpportunityStatusFilter';

export default function Opportunities() {
  const { getHeaders } = useAuth();
  const [filter, setFilter] = useState('ALL');
  const [state, setState] = useState({ loading: true, data: [], error: '' });
  useEffect(() => { fetch('/api/opportunity-workspaces', { headers: getHeaders() }).then(async response => { if (!response.ok) throw new Error((await response.json()).error || 'Opportunities unavailable'); return response.json(); }).then(data => setState({ loading:false, data:data.opportunities || [], error:'' })).catch(error => setState({ loading:false, data:[], error:error.message })); }, []);
  const visible = useMemo(() => state.data.filter(item => filter === 'ALL' || (filter === 'COMPLETE' ? item.review?.valid : filter === 'INVALIDATED' ? item.review?.status === 'INVALIDATED' : !item.review?.valid && item.review?.status !== 'INVALIDATED')), [state.data, filter]);
  return <div className="coi-page"><header className="coi-page-header"><div><p className="coi-eyebrow">Commercial portfolio</p><h1>Opportunities</h1><p>Server-prioritised opportunities, controlled review state and customer-selected next actions.</p></div><OpportunityStatusFilter value={filter} onChange={setFilter}/></header>
    {state.loading ? <div className="coi-skeleton tall" aria-busy="true"/> : state.error ? <section role="alert" className="coi-card coi-error"><h2>Opportunities could not be loaded</h2><p>{state.error}</p></section> : <OpportunityList opportunities={visible}/>}
  </div>;
}
