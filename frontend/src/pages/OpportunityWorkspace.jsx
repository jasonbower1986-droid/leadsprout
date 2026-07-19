import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const stages = ['Candidates', 'Selection', 'Opportunity', 'Offer', 'Conversation', 'Next Action'];

export default function OpportunityWorkspace() {
  const { getHeaders, token } = useAuth();
  const [leads, setLeads] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [selected, setSelected] = useState([]);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { fetch('/api/leads', { headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).then(r => r.json()).then(setLeads).catch(() => setError('Candidates could not be loaded.')); }, [token]);
  const request = async (path, options = {}) => {
    const response = await fetch(path, { ...options, headers: getHeaders() });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error || 'Request failed');
    return data;
  };
  const create = async () => {
    try {
      setError('');
      const created = await request('/api/opportunity-workspaces', { method: 'POST', body: JSON.stringify({
        title: 'Commercial Opportunity Decision', capability_profile: {
          service_capabilities: ['conversion', 'accessibility', 'trust', 'local visibility'],
          delivery_constraints: [], geography: [], capacity: 'AVAILABLE', exclusions: [], disqualifiers: []
        }
      }) });
      for (const leadId of selected) await request(`/api/opportunity-workspaces/${created.workspace_id}/candidates`, { method: 'POST', body: JSON.stringify({ lead_id: leadId, comparison_context: 'CURRENT_PIPELINE', evidence_window: new Date().toISOString().slice(0,10) }) });
      setWorkspace(created); setStage(1);
      const evaluation = await request(`/api/opportunity-workspaces/${created.workspace_id}/evaluations`, { method: 'POST', body: JSON.stringify({ expected_version: 0 }) });
      setResult({ evaluation });
    } catch (e) { setError(e.message); }
  };
  const prepareOffer = async () => { try { const offer = await request(`/api/opportunity-workspaces/${workspace.workspace_id}/offer`, { method: 'POST', body: '{}' }); setResult(v => ({ ...v, offer })); setStage(3); } catch (e) { setError(e.message); } };
  const prepareConversation = async () => { try { const conversation = await request(`/api/opportunity-workspaces/${workspace.workspace_id}/conversation`, { method: 'POST', body: JSON.stringify({ target_role_category: 'Business owner or commercial decision-maker' }) }); setResult(v => ({ ...v, conversation })); setStage(4); } catch (e) { setError(e.message); } };
  const nextAction = async () => { try { const action = await request(`/api/opportunity-workspaces/${workspace.workspace_id}/actions`, { method: 'POST', body: JSON.stringify({ type: 'PURSUE', rationale: 'Customer chose to begin a truthful commercial conversation.' }) }); setResult(v => ({ ...v, action })); setStage(5); } catch (e) { setError(e.message); } };

  return <div className="space-y-6">
    <div><p className="text-emerald-600 font-black uppercase tracking-widest text-xs">Commercial Opportunity Intelligence</p><h1 className="text-3xl font-black text-slate-900">Opportunity Decision Workspace</h1><p className="text-slate-600 mt-2">Compare evidence-backed opportunities and carry one decision through to a customer-controlled next action.</p></div>
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">{stages.map((name, i) => <div key={name} className={`rounded-xl p-3 text-xs font-bold ${i <= stage ? 'bg-emerald-500 text-slate-950' : 'bg-slate-200 text-slate-500'}`}>{i+1}. {name}</div>)}</div>
    {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl">{error}</div>}
    {!workspace && <section className="bg-white border border-slate-200 rounded-2xl p-6">
      <h2 className="font-black text-xl">Choose at least three candidates</h2><p className="text-sm text-slate-500 mb-4">Candidates must share the same current comparison context.</p>
      <div className="grid md:grid-cols-3 gap-3">{leads.map(lead => <label key={lead.id} className="border rounded-xl p-4 flex gap-3"><input type="checkbox" checked={selected.includes(lead.id)} onChange={e => setSelected(v => e.target.checked ? [...v, lead.id] : v.filter(id => id !== lead.id))}/><span><b>{lead.business_name || lead.domain}</b><small className="block text-slate-500">{lead.niche || 'General'} · {lead.opportunity_understanding?.status || 'Evidence unavailable'}</small></span></label>)}</div>
      <button disabled={selected.length < 3} onClick={create} className="mt-5 bg-slate-900 disabled:bg-slate-300 text-white rounded-xl px-5 py-3 font-bold">Compare selected candidates</button>
    </section>}
    {result?.evaluation && <section className="bg-white border rounded-2xl p-6 space-y-4"><h2 className="font-black text-xl">Selection</h2><div className="text-2xl font-black">{result.evaluation.result === 'LEAD_SELECTED' ? 'Lead selected' : 'No winner'}</div><p>{result.evaluation.comparative_explanation}</p><div className="grid md:grid-cols-3 gap-3">{result.evaluation.outcomes.map(item => <div key={item.candidate_snapshot_id} className="border rounded-xl p-4"><b>{item.outcome}</b><p className="text-sm mt-2">{item.decisive_reason}</p><p className="text-xs text-slate-500 mt-2">Confidence: {item.confidence_basis}</p></div>)}</div>{result.evaluation.result === 'LEAD_SELECTED' && !result.offer && <button onClick={prepareOffer} className="bg-emerald-500 rounded-xl px-5 py-3 font-bold">Understand opportunity and offer</button>}</section>}
    {result?.offer && <section className="bg-white border rounded-2xl p-6"><h2 className="font-black text-xl">Opportunity and offer</h2><p className="font-bold mt-3">{result.offer.primary_service_direction}</p><p>{result.offer.problem_fit}</p><p className="text-slate-600 mt-2">{result.offer.intended_qualitative_outcome}</p>{!result.conversation && <button onClick={prepareConversation} className="mt-4 bg-emerald-500 rounded-xl px-5 py-3 font-bold">Prepare truthful conversation</button>}</section>}
    {result?.conversation && <section className="bg-white border rounded-2xl p-6"><h2 className="font-black text-xl">Conversation</h2><p className="mt-3"><b>Role:</b> {result.conversation.target_role_category}</p><p><b>Opening question:</b> {result.conversation.bounded_question}</p><p><b>Explore:</b> {result.conversation.offer_to_explore}</p>{!result.action && <button onClick={nextAction} className="mt-4 bg-emerald-500 rounded-xl px-5 py-3 font-bold">Choose next action</button>}</section>}
    {result?.action && <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6"><h2 className="font-black text-xl">Next action retained</h2><p>{result.action.state}: pursue the selected evidence-backed opportunity.</p></section>}
  </div>;
}
