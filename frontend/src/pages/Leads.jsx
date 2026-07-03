import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Zap, Search, MapPin, CheckCircle,
  AlertTriangle, Loader, Copy,
  Check, Lock, ArrowUpRight, FileText, X, TrendingDown, Quote, Trophy
} from 'lucide-react';

export default function Leads() {
  const navigate = useNavigate();
  const { user, getHeaders, refreshUser, personaConfig } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [nicheFilter, setNicheFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [gapFilter, setGapFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [pitch, setPitch] = useState(null);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [activeAgencyTab, setActiveAgencyTab] = useState('pitch');
  const [sequence, setSequence] = useState(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [crmExporting, setCrmExporting] = useState(false);
  const [activeSequenceStep, setActiveSequenceStep] = useState(1);
  const [copiedSeqBody, setCopiedSeqBody] = useState(false);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (nicheFilter) params.append('niche', nicheFilter);
      if (locationFilter) params.append('location', locationFilter);
      if (tagFilter) params.append('tag', tagFilter);
      
      const res = await fetch(`/api/leads?${params.toString()}`, { headers: getHeaders() });
      if (res.ok) {
        let data = await res.json();
        if (gapFilter === 'not_responsive') {
          data = data.filter(l => l.responsive_status !== 'responsive');
        } else if (gapFilter === 'slow_speed') {
          data = data.filter(l => l.speed_score < 40);
        }
        if (search) {
          data = data.filter(l => 
            l.business_name.toLowerCase().includes(search.toLowerCase()) ||
            l.website_url.toLowerCase().includes(search.toLowerCase())
          );
        }
        setLeads(data);
      }
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [nicheFilter, locationFilter, gapFilter, tagFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchLeads();
  };

  const handleUnlock = async (leadId) => {
    try {
      const res = await fetch(`/api/leads/${leadId}/unlock`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (res.ok) {
        await refreshUser();
        await fetchLeads();
        const updatedLead = leads.find(l => l.id === leadId);
        if (updatedLead) {
          setSelectedLead({ ...updatedLead, is_unlocked: true });
        }
      } else {
        const data = await res.json();
        alert(data.error || 'Unlock failed');
      }
    } catch (err) {
      alert('Network error during unlock');
    }
  };

  const generatePitch = async (leadId) => {
    try {
      setPitchLoading(true);
      const res = await fetch(`/api/leads/${leadId}/pitch`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPitch(data.pitch);
      }
    } catch (err) {
      console.error('Failed to generate pitch');
    } finally {
      setPitchLoading(false);
    }
  };

  const generateSequence = async (leadId) => {
    try {
      setSequenceLoading(true);
      const res = await fetch(`/api/leads/${leadId}/sequence`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSequence(data.sequence);
      }
    } catch (err) {
      console.error('Failed to generate sequence');
    } finally {
      setSequenceLoading(false);
    }
  };

  const handleCRMExport = async (leadId, provider) => {
    try {
      setCrmExporting(true);
      setActionError('');
      setActionSuccess('');
      const res = await fetch(`/api/crm/export`, {
        method: 'POST',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, provider })
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(`Successfully synced to ${provider}!`);
      } else {
        setActionError(data.error || `Failed to sync to ${provider}. Check your CRM settings.`);
      }
    } catch (err) {
      setActionError('Connection error during CRM export.');
    } finally {
      setCrmExporting(false);
    }
  };

  const handleCopySubject = () => {
    navigator.clipboard.writeText(pitch.subject);
    setCopiedSubject(true);
    setTimeout(() => setCopiedSubject(false), 2000);
  };

  const handleCopyBody = () => {
    navigator.clipboard.writeText(pitch.body);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  const handleCopySeqBody = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedSeqBody(true);
    setTimeout(() => setCopiedSeqBody(false), 2000);
  };

  useEffect(() => {
    if (selectedLead?.is_unlocked) {
      generatePitch(selectedLead.id);
      setSequence(null);
      setActionError('');
      setActionSuccess('');
    }
  }, [selectedLead?.id]);

  const niches = ["Dentist", "Plumbing", "Legal Services", "Roofing", "HVAC", "Healthcare", "Auto Repair", "Catering & Events", "Landscaping", "Pool Maintenance", "Pest Control", "Hospitality", "Pet Services", "Construction", "Financial Services", "Fitness", "Retail / Florist", "Beauty / Wellness", "Locksmith", "Cleaning Services", "Electrical Services", "Tree Care"];
  const discoveryPatterns = [
    "Neglected Digital Storefront",
    "Premium Business, Budget Website",
    "High-Traffic, Low-Conversion Opportunity",
    "Mobile Confidence Breakdown",
    "Competitive Neglect",
    "Local Visibility Gap",
    "Trust Deficit",
    "Booking Friction",
    "Reputation Leakage",
    "Outdated Customer Experience",
    "Authority Without Credibility",
    "Revenue Bottleneck",
    "Digital First Impression Failure"
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
        <form onSubmit={handleSearch} className="flex-1 max-w-2xl relative w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl py-3 md:py-3.5 pl-11 md:pl-12 pr-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-medium text-sm md:text-base"
          />
        </form>
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-xl md:rounded-2xl flex-1 md:flex-initial text-center md:text-left">
            <span className="text-[9px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-widest block">Live Database</span>
            <span className="text-lg md:text-xl font-black text-slate-900">{leads.length} Leads</span>
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 md:gap-8">
        <div className="flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4">
            <select 
              value={nicheFilter}
              onChange={(e) => setNicheFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs md:text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">All Niches</option>
              {niches.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <input 
              type="text"
              placeholder="Location..."
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs md:text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <select 
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs md:text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">All Patterns</option>
              {discoveryPatterns.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select 
              value={gapFilter}
              onChange={(e) => setGapFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs md:text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">All Growth Gaps</option>
              <option value="not_responsive">Mobile Rendering Errors</option>
              <option value="slow_speed">Sluggish Page Speed</option>
            </select>
          </div>

          <div className="space-y-4">
            {loading ? (
              <div className="py-20 text-center"><Loader className="animate-spin text-emerald-500 mx-auto" size={32} /></div>
            ) : leads.length === 0 ? (
              <div className="py-20 text-center bg-white border border-slate-200 rounded-2xl md:rounded-3xl">
                <p className="text-slate-400 font-medium text-sm md:text-base">No prospects found matching your filters.</p>
              </div>
            ) : leads.map(lead => (
              <div 
                key={lead.id}
                onClick={() => setSelectedLead(lead)}
                className={`group bg-white border transition-all cursor-pointer rounded-xl md:rounded-2xl p-4 md:p-5 flex items-center justify-between ${selectedLead?.id === lead.id ? 'border-emerald-500 ring-4 ring-emerald-500/5 translate-x-1 md:translate-x-2' : 'border-slate-200 hover:border-emerald-300'}`}
              >
                <div className="flex items-center gap-3 md:gap-5 min-w-0">
                  <div className="w-10 h-10 md:w-14 md:h-14 bg-slate-50 rounded-lg md:rounded-xl border border-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors shrink-0">
                    <Zap size={24} md:size={28} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] md:text-[10px] font-black text-emerald-600 uppercase tracking-widest block mb-0.5">{lead.niche}</span>
                    <h3 className="text-base md:text-lg font-black text-slate-900 group-hover:text-emerald-600 transition-colors truncate">{lead.business_name}</h3>
                    <div className="flex items-center gap-2 md:gap-3 mt-1 md:mt-1.5">
                      <span className="flex items-center gap-1 text-[10px] md:text-xs text-slate-400 font-medium truncate"><MapPin size={10} md:size={12} /> {lead.location}</span>
                      <span className="w-1 h-1 bg-slate-200 rounded-full shrink-0" />
                      <span className={`text-[10px] md:text-xs font-bold shrink-0 ${lead.speed_score >= 80 ? 'text-emerald-500' : lead.speed_score >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>{lead.speed_score}/100</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 md:gap-6 shrink-0">
                  <div className="hidden sm:flex flex-wrap justify-end gap-2 max-w-[200px]">
                    {lead.discovery_tags && lead.discovery_tags.length > 0 && (
                      <span className="bg-emerald-50 text-emerald-600 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:py-1 rounded-md border border-emerald-100 uppercase tracking-tighter shadow-sm">
                        {lead.discovery_tags[0]}
                      </span>
                    )}
                    {lead.responsive_status !== 'responsive' && <span className="bg-rose-50 text-rose-600 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:py-1 rounded-md border border-rose-100 uppercase tracking-tighter">Mobile Friction</span>}
                    {lead.speed_score < 50 && <span className="bg-amber-50 text-amber-600 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:py-1 rounded-md border border-amber-100 uppercase tracking-tighter">Loading Drain</span>}
                  </div>
                  {lead.is_unlocked ? (
                    <CheckCircle className="text-emerald-500" size={20} md:size={24} />
                  ) : (
                    <Lock className="text-slate-300" size={18} md:size={20} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`
          lg:w-[400px] xl:w-[450px]
          ${selectedLead ? 'fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-0' : 'hidden lg:block'}
        `}>
          {selectedLead ? (
            <div className="bg-white border border-slate-200 h-full lg:h-auto lg:rounded-3xl p-6 md:p-8 shadow-2xl lg:sticky lg:top-8 overflow-y-auto">
              <div className="flex items-center justify-between mb-6 md:mb-8">
                <h3 className="text-xl md:text-2xl font-black text-slate-900">Lead Intelligence</h3>
                <button onClick={() => setSelectedLead(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>

              <div className="mb-6 md:mb-8 space-y-4 text-left">
                {/* Commercial-First Reasoning Hierarchy */}
                <div className="bg-slate-900 rounded-2xl p-5 text-white overflow-hidden relative shadow-lg">
                  <div className="relative z-10">
                    <div className="flex justify-between items-center mb-5">
                      <div className="flex items-center gap-2">
                        <div className="bg-emerald-500 p-1 rounded-md text-slate-900">
                          <Zap size={14} fill="currentColor" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Discovery Pattern</span>
                      </div>
                      <div className="bg-white/10 backdrop-blur-md px-3 py-1 rounded-full text-[9px] font-black border border-white/10 uppercase tracking-tighter text-emerald-300">
                        {selectedLead.strategy_report?.discovery_hierarchy?.commercial_behaviour || 'Acquisition'}
                      </div>
                    </div>
                    
                    {selectedLead.strategy_report && (
                      <div className="mb-5 space-y-4">
                        {/* 1. The Pattern Name */}
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                            {selectedLead.strategy_report.discovery_hierarchy?.business_type || 'General'} Pattern
                          </div>
                          <div className="text-xl font-black text-white leading-tight">
                            {selectedLead.strategy_report.discovery_hierarchy?.opportunity_pattern || selectedLead.strategy_report.hidden_ceiling}
                          </div>
                          <p className="text-xs text-slate-300 mt-2 leading-relaxed italic">
                            "{selectedLead.opportunity_brief?.hook || selectedLead.strategy_report.commercial_impact}"
                          </p>
                        </div>

                        {/* Visual Evidence (Screenshot) */}
                        {selectedLead.screenshot_path && (
                          <div className="mt-4 rounded-xl overflow-hidden border border-white/10 shadow-inner group relative">
                            <img 
                              src={`/screenshots/${selectedLead.screenshot_path.split('/').pop()}`} 
                              alt="Mobile Viewport Evidence"
                              className="w-full h-auto object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            />
                            <div className="absolute top-2 right-2 bg-rose-500 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-tighter">
                              Verified Breakdown
                            </div>
                          </div>
                        )}

                        {/* 2. The Opportunity (The Solution) */}
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Trophy size={14} className="text-emerald-400" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Service to Pitch</span>
                          </div>
                          <div className="text-sm font-black text-white">
                            {selectedLead.opportunity_brief?.service_to_pitch || selectedLead.strategy_report.opportunity?.service_to_pitch}
                          </div>
                          <p className="text-[11px] text-emerald-100/70 mt-1 leading-relaxed">
                            {selectedLead.opportunity_brief?.pitch_reason || selectedLead.strategy_report.opportunity?.impact_summary}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/10">
                      <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <span className="text-[8px] font-bold text-slate-400 uppercase block mb-1">Pitch Urgency</span>
                        <div className="text-xl font-black text-emerald-400">{selectedLead.pitch_urgency || (100 - selectedLead.speed_score)}</div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <span className="text-[8px] font-bold text-slate-400 uppercase block mb-1">Revenue Leak</span>
                        <div className="text-xl font-black text-rose-400">{selectedLead.revenue_leak?.loss_percentage || '20'}%</div>
                        <div className="text-[8px] text-rose-300/60 font-bold uppercase mt-0.5">{selectedLead.revenue_leak?.formatted_leak || '$2.4k'}/mo</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl p-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Supporting Proof (Technical)</span>
                  <div className="space-y-3">
                    {selectedLead.strategy_report?.supporting_proof?.map((proof, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2.5">
                        <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                        <span className="text-[11px] font-bold text-slate-700">{proof}</span>
                      </div>
                    ))}
                    
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="bg-white border border-slate-200 rounded-lg p-3">
                        <span className="text-[9px] font-bold text-slate-400 block mb-1 uppercase tracking-tight">Accessibility</span>
                        {selectedLead.responsive_status === 'responsive' ? <CheckCircle size={14} className="text-emerald-500" /> : <AlertTriangle size={14} className="text-rose-500" />}
                        <span className="text-[8px] text-slate-400 block mt-1 uppercase font-bold">{selectedLead.responsive_status === 'responsive' ? 'Optimized' : 'Failing'}</span>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg p-3">
                        <span className="text-[9px] font-bold text-slate-400 block mb-1 uppercase tracking-tight">Speed Score</span>
                        <span className={`text-sm font-black ${selectedLead.speed_score >= 80 ? 'text-emerald-500' : 'text-rose-500'}`}>{selectedLead.speed_score}/100</span>
                      </div>
                    </div>
                  </div>
                  
                  {selectedLead.advisor_quote && (
                    <div className="mt-4 bg-white border border-slate-200 rounded-xl p-3">
                       <p className="text-[10px] text-slate-500 italic leading-relaxed">
                        "{selectedLead.advisor_quote}"
                       </p>
                    </div>
                  )}
                </div>

                {/* v5.2 Growth Roadmap — 3-Phase Timeline */}
                {selectedLead.growth_roadmap?.phases?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl md:rounded-2xl p-4 md:p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingDown size={14} className="text-emerald-500" />
                      <h4 className="text-[10px] md:text-xs font-black text-slate-700 uppercase tracking-widest">Growth Roadmap</h4>
                      <span className="ml-auto text-[8px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {selectedLead.growth_roadmap.totalConfidence}% confidence
                      </span>
                    </div>
                    <div className="relative">
                      {/* Timeline connecting line */}
                      <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-emerald-200 rounded-full" />
                      
                      <div className="space-y-5">
                        {selectedLead.growth_roadmap.phases.map((phase, idx) => (
                          <div key={idx} className="relative pl-8">
                            {/* Timeline dot */}
                            <div className={`absolute left-0 top-1 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center text-[9px] font-black ${
                              idx === 0 
                                ? 'bg-emerald-500 border-emerald-500 text-white' 
                                : idx === 1 
                                  ? 'bg-amber-500 border-amber-500 text-white'
                                  : 'bg-slate-300 border-slate-300 text-white'
                            }`}>
                              {idx + 1}
                            </div>
                            
                            {/* Phase content */}
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                              <div className="flex justify-between items-start mb-1">
                                <div className="text-[9px] font-black text-slate-900 leading-tight pr-2">
                                  {phase.title}
                                </div>
                                <div className={`text-[8px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                                  phase.confidence >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                  phase.confidence >= 60 ? 'bg-amber-100 text-amber-700' :
                                  'bg-rose-100 text-rose-700'
                                }`}>
                                  {phase.confidence}%
                                </div>
                              </div>
                              
                              {phase.commercialHook && (
                                <p className="text-[9px] text-slate-500 italic mt-1 leading-relaxed">
                                  "{phase.commercialHook}"
                                </p>
                              )}
                              {phase.serviceToPitch && (
                                <div className="mt-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
                                  <span className="text-[7px] font-bold text-slate-400 uppercase tracking-wider">Recommendation</span>
                                  <p className="text-[9px] font-bold text-slate-700">{phase.serviceToPitch}</p>
                                </div>
                              )}
                              {phase.transition && idx < selectedLead.growth_roadmap.phases.length - 1 && (
                                <div className="mt-2 flex items-center gap-1.5 text-[8px] text-slate-400">
                                  <ArrowUpRight size={10} className="text-emerald-500 shrink-0" />
                                  <span>{phase.transition}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {selectedLead.is_unlocked ? (
                  <div className="space-y-4">
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl md:rounded-2xl p-4 md:p-5">
                      <h4 className="text-[10px] md:text-xs font-black text-emerald-700 uppercase tracking-widest mb-3">Decision Makers</h4>
                      <div className="space-y-2">
                        {selectedLead.verified_emails.map((email, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-lg md:rounded-xl px-3 py-2">
                            <span className="font-mono text-[10px] md:text-xs text-emerald-300 truncate mr-2">{email}</span>
                            <button onClick={() => { navigator.clipboard.writeText(email); alert('Copied!'); }} className="text-slate-500 hover:text-white shrink-0"><Copy size={12} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-slate-800/40 border border-slate-800/80 rounded-xl md:rounded-2xl p-4 md:p-5">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                        <h4 className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">Outreach Toolkit</h4>
                        <div className="flex bg-slate-950 p-1 rounded-lg text-[9px] font-bold shrink-0">
                          <button onClick={() => setActiveAgencyTab('pitch')} className={`px-2 py-1 rounded ${activeAgencyTab === 'pitch' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500'}`}>Pitch</button>
                          <button onClick={() => setActiveAgencyTab('sequence')} className={`px-2 py-1 rounded flex items-center gap-1 ${activeAgencyTab === 'sequence' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500'}`}>Seq</button>
                          <button onClick={() => setActiveAgencyTab('crm')} className={`px-2 py-1 rounded flex items-center gap-1 ${activeAgencyTab === 'crm' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500'}`}>CRM</button>
                        </div>
                      </div>
                      {actionSuccess && <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-2 rounded-xl text-[10px] md:text-xs mb-4">{actionSuccess}</div>}
                      {actionError && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-3 py-2 rounded-xl text-[10px] md:text-xs mb-4">{actionError}</div>}
                      {activeAgencyTab === 'pitch' && (
                        pitchLoading ? <Loader className="animate-spin text-emerald-400 mx-auto" size={20} /> : pitch && (
                          <div className="space-y-3">
                            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 flex justify-between gap-2">
                              <span className="text-[10px] md:text-xs text-white font-bold truncate">{pitch.subject}</span>
                              <button onClick={handleCopySubject} className="text-slate-500 hover:text-white shrink-0">{copiedSubject ? <Check size={14} /> : <Copy size={14} />}</button>
                            </div>
                            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                              <pre className="text-slate-300 text-[10px] whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">{pitch.body}</pre>
                              <button onClick={handleCopyBody} className="mt-3 w-full bg-emerald-500 text-slate-950 font-bold text-[10px] py-2 rounded-lg transition-colors active:bg-emerald-400">{copiedBody ? 'Copied!' : 'Copy Body'}</button>
                            </div>
                          </div>
                        )
                      )}
                      {activeAgencyTab === 'sequence' && (
                        user?.plan !== 'agency' ? (
                          <div className="text-center py-4">
                            <p className="text-[10px] text-slate-400 mb-3">Sequences require the Agency Plan.</p>
                            <button onClick={() => navigate('/settings')} className="bg-emerald-500 text-slate-950 font-bold text-[10px] px-4 py-2 rounded-lg">Upgrade</button>
                          </div>
                        ) : (
                          sequenceLoading ? <Loader className="animate-spin text-emerald-400 mx-auto" size={20} /> : !sequence ? (
                            <button onClick={() => generateSequence(selectedLead.id)} className="w-full bg-emerald-500 text-slate-950 font-bold text-[10px] py-2 rounded-lg">Generate Sequence</button>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex bg-slate-950 p-1 rounded-lg text-[9px] font-bold">
                                {sequence.map(s => <button key={s.step} onClick={() => setActiveSequenceStep(s.step)} className={`flex-1 py-1 rounded ${activeSequenceStep === s.step ? 'bg-slate-800 text-emerald-400' : 'text-slate-500'}`}>Step {s.step}</button>)}
                              </div>
                              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                                <p className="text-white font-bold text-[10px] mb-2">{sequence[activeSequenceStep-1].subject}</p>
                                <pre className="text-slate-300 text-[10px] whitespace-pre-wrap font-sans leading-relaxed max-h-32 overflow-y-auto">{sequence[activeSequenceStep-1].body}</pre>
                                <button onClick={() => handleCopySeqBody(sequence[activeSequenceStep-1].body)} className="mt-3 w-full bg-emerald-500 text-slate-950 font-bold text-[10px] py-2 rounded-lg transition-colors active:bg-emerald-400">{copiedSeqBody ? 'Copied!' : 'Copy Text'}</button>
                              </div>
                            </div>
                          )
                        )
                      )}
                      {activeAgencyTab === 'crm' && (
                        user?.plan !== 'agency' ? (
                          <div className="text-center py-4">
                            <p className="text-[10px] text-slate-400 mb-3">CRM Sync requires the Agency Plan.</p>
                            <button onClick={() => navigate('/settings')} className="bg-emerald-500 text-slate-950 font-bold text-[10px] px-4 py-2 rounded-lg">Upgrade</button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-2">
                            <button onClick={() => handleCRMExport(selectedLead.id, 'hubspot')} disabled={crmExporting} className="bg-orange-500 text-white font-bold text-[10px] py-2 rounded-lg transition-colors active:bg-orange-400">Sync to HubSpot</button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-800/40 border border-slate-800/80 rounded-xl md:rounded-2xl p-5 md:p-6 text-center space-y-4">
                    <Lock size={20} md:size={24} className="mx-auto text-emerald-500" />
                    <p className="text-[10px] md:text-xs text-slate-400">Unlock this lead to view contact emails and outreach pitches.</p>
                    <button onClick={() => handleUnlock(selectedLead.id)} className="w-full bg-emerald-500 text-slate-950 font-bold text-xs md:text-sm py-2.5 md:py-3 rounded-xl transition-colors active:bg-emerald-400">Unlock Lead (1 Credit)</button>
                  </div>
                )}
                <button onClick={() => window.open(`/demo/${selectedLead.id}?via=${user.id}`, '_blank')} className="w-full bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all">
                  <ArrowUpRight size={14} /> Open Public Audit Proposal
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl md:rounded-3xl p-8 text-center text-slate-500 flex flex-col items-center justify-center py-24 border-dashed lg:sticky lg:top-8">
              <FileText size={32} md:size={40} className="text-slate-300 mb-3" />
              <h4 className="font-bold text-slate-800 text-sm md:text-base">No Lead Selected</h4>
              <p className="text-[10px] md:text-xs text-slate-400 mt-1">Select a prospect from the list to see their audit diagnostics.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
