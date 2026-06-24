import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  Zap, Search, MapPin, Tag, Mail, ShieldAlert, CheckCircle, 
  AlertTriangle, Smartphone, ChevronRight, LogOut, Loader, Copy,
  Check, Lock, ArrowUpRight, BarChart2, Calendar, FileText
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, getHeaders, refreshUser } = useAuth();

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Search and Filter State
  const [search, setSearch] = useState('');
  const [nicheFilter, setNicheFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [gapFilter, setGapFilter] = useState('');

  // Selected Lead & Pitch Generation State
  const [selectedLead, setSelectedLead] = useState(null);
  const [pitch, setPitch] = useState(null);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Agency Subscription Tier State Variables
  const [activeAgencyTab, setActiveAgencyTab] = useState('pitch'); // 'pitch', 'sequence', 'crm'
  const [sequence, setSequence] = useState(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [crmExporting, setCrmExporting] = useState(false);
  const [activeSequenceStep, setActiveSequenceStep] = useState(1);
  const [copiedSeqSubject, setCopiedSeqSubject] = useState(false);
  const [copiedSeqBody, setCopiedSeqBody] = useState(false);

  // Fetch leads list
  const fetchLeads = async () => {
    try {
      setLoading(true);
      
      // Build filter query parameters
      const params = new URLSearchParams();
      if (nicheFilter) params.append('niche', nicheFilter);
      if (locationFilter) params.append('location', locationFilter);
      if (gapFilter && gapFilter !== 'not_responsive' && gapFilter !== 'slow_speed') {
        params.append('gap', gapFilter);
      }

      const res = await fetch(`/api/leads?${params.toString()}`, {
        headers: getHeaders()
      });

      if (res.ok) {
        let data = await res.json();

        // Apply client-side filters for special responsive or speed gaps
        if (gapFilter === 'not_responsive') {
          data = data.filter(l => l.responsive_status === 'not_responsive');
        } else if (gapFilter === 'slow_speed') {
          data = data.filter(l => l.speed_score < 60);
        }

        // Apply search keyword filter across business name and domain
        if (search) {
          const keyword = search.toLowerCase();
          data = data.filter(l => 
            l.business_name.toLowerCase().includes(keyword) || 
            l.domain.toLowerCase().includes(keyword)
          );
        }

        setLeads(data);
        
        // Update selectedLead instance if it was modified
        if (selectedLead) {
          const updated = data.find(l => l.id === selectedLead.id);
          if (updated) setSelectedLead(updated);
        }
      }
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [nicheFilter, locationFilter, gapFilter, search]);

  // Load custom pitch when a lead is selected and already unlocked
  useEffect(() => {
    if (selectedLead && selectedLead.is_unlocked) {
      generatePitch(selectedLead.id);
    } else {
      setPitch(null);
    }
    // Reset Agency tools and feedback state when lead context changes
    setActiveAgencyTab('pitch');
    setSequence(null);
    setActiveSequenceStep(1);
    setActionError('');
    setActionSuccess('');
  }, [selectedLead?.id, selectedLead?.is_unlocked]);

  // Generate outreach pitch from server
  const generatePitch = async (leadId) => {
    try {
      setPitchLoading(true);
      setPitch(null);
      const res = await fetch(`/api/leads/${leadId}/pitch`, {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setPitch(data);
      }
    } catch (err) {
      console.error('Failed to generate pitch:', err);
    } finally {
      setPitchLoading(false);
    }
  };

  // Generate 3-step outreach sequence from server (Agency exclusive)
  const generateSequence = async (leadId) => {
    try {
      setSequenceLoading(true);
      setSequence(null);
      setActionError('');
      setActionSuccess('');
      const res = await fetch(`/api/leads/${leadId}/outreach-sequence`, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setSequence(data.sequence);
        setActionSuccess('Automated 3-Step Outreach Sequence tailored successfully!');
      } else {
        setActionError(data.error || 'Failed to generate outreach sequence.');
      }
    } catch (err) {
      console.error('Failed to generate sequence:', err);
      setActionError('Network error generating outreach sequence.');
    } finally {
      setSequenceLoading(false);
    }
  };

  // Export unlocked lead to HubSpot or Pipedrive pipeline (Agency exclusive)
  const handleCRMExport = async (leadId, platform) => {
    try {
      setCrmExporting(true);
      setActionError('');
      setActionSuccess('');
      const res = await fetch(`/api/leads/${leadId}/export`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ platform })
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(data.message || `Lead successfully exported to ${platform}!`);
      } else {
        setActionError(data.error || 'Failed to export lead to CRM.');
      }
    } catch (err) {
      console.error('Failed to export to CRM:', err);
      setActionError('Network error exporting to CRM.');
    } finally {
      setCrmExporting(false);
    }
  };

  // Perform lead unlocking
  const handleUnlock = async (leadId) => {
    setActionError('');
    setActionSuccess('');
    
    try {
      const res = await fetch(`/api/leads/${leadId}/unlock`, {
        method: 'POST',
        headers: getHeaders()
      });

      const data = await res.json();

      if (res.ok) {
        setActionSuccess('Lead unlocked successfully!');
        
        // Refresh leads list to reveal email & update credit display
        await refreshUser();
        await fetchLeads();
      } else {
        setActionError(data.error || 'Failed to unlock lead.');
      }
    } catch (err) {
      setActionError('Network error. Failed to unlock lead.');
    }
  };

  // Copy helpers
  const handleCopySubject = () => {
    if (!pitch) return;
    navigator.clipboard.writeText(pitch.subject);
    setCopiedSubject(true);
    setTimeout(() => setCopiedSubject(false), 2000);
  };

  const handleCopyBody = () => {
    if (!pitch) return;
    navigator.clipboard.writeText(pitch.body);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  const handleCopySeqSubject = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSeqSubject(true);
    setTimeout(() => setCopiedSeqSubject(false), 2000);
  };

  const handleCopySeqBody = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSeqBody(true);
    setTimeout(() => setCopiedSeqBody(false), 2000);
  };

  // Extract unique niches for filter options
  const niches = ["Dentist", "Plumbing", "Legal Services", "Roofing", "HVAC", "Healthcare", "Auto Repair", "Catering & Events", "Landscaping", "Pool Maintenance", "Pest Control", "Hospitality", "Pet Services", "Construction", "Financial Services", "Fitness", "Retail / Florist", "Beauty / Wellness", "Locksmith", "Cleaning Services", "Electrical Services", "Tree Care"];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans lg:flex-row">
      {/* Sidebar Navigation */}
      <aside className="bg-slate-900 text-white lg:w-72 shrink-0 border-r border-slate-800 flex flex-col justify-between">
        <div>
          {/* Logo Brand Header */}
          <div className="h-16 flex items-center gap-2.5 px-6 border-b border-slate-800">
            <div className="bg-emerald-500 text-slate-950 p-1.5 rounded-xl flex items-center justify-center">
              <Zap size={18} fill="currentColor" />
            </div>
            <span className="font-extrabold text-xl tracking-tight text-white">LeadSprout</span>
          </div>

          {/* User Billing Context Box */}
          <div className="p-5 border-b border-slate-800">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Active Subscriber</span>
              <span className="text-sm font-semibold text-white truncate block mt-1">{user?.email}</span>
              
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-slate-400">Plan Tier:</span>
                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider">
                  {user?.plan}
                </span>
              </div>

              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-xs text-slate-400">Unlock Credits:</span>
                <span className="text-xs font-bold text-white">
                  {user?.plan === 'agency' ? 'Unlimited' : `${user?.unlocks_count} / ${user?.max_credits}`}
                </span>
              </div>

              {user?.plan === 'free' && (
                <button
                  onClick={() => navigate('/checkout')}
                  className="mt-4 w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs py-2 rounded-xl transition-all"
                >
                  Upgrade to Basic / Pro
                </button>
              )}
            </div>
          </div>

          {/* Statistics summary */}
          <div className="p-6">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-4">Market Gaps Available</span>
            <div className="space-y-3.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 font-medium">Pre-audited Leads:</span>
                <span className="text-white font-bold bg-slate-800 px-2.5 py-0.5 rounded-md text-xs">25 Total</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 font-medium">Non-Responsive:</span>
                <span className="text-rose-400 font-bold bg-rose-500/10 px-2.5 py-0.5 rounded-md text-xs">11 Found</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 font-medium">Critical Performance Gaps:</span>
                <span className="text-amber-400 font-bold bg-amber-500/10 px-2.5 py-0.5 rounded-md text-xs">17 Found</span>
              </div>
            </div>
          </div>
        </div>

        {/* Logout section */}
        <div className="p-5 border-t border-slate-800">
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800/50 py-3 rounded-xl transition-all text-sm font-semibold"
          >
            <LogOut size={16} /> Log Out Account
          </button>
        </div>
      </aside>

      {/* Main Board Content Panel */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Filter & Query Header */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex-1 max-w-md relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={16} />
            </div>
            <input
              type="text"
              placeholder="Search by business domain or keywords..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider hidden sm:block">Agent Portal Status:</span>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" /> Database Synced
            </span>
          </div>
        </header>

        {/* Filters and List view layout */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col xl:flex-row gap-6">
          
          {/* Leads Board Grid Column */}
          <div className="flex-1 space-y-4">
            {/* Filter Bar Panel */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                
                {/* Niche Dropdown */}
                <div className="relative">
                  <select
                    value={nicheFilter}
                    onChange={(e) => setNicheFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="">All Niches (Any Category)</option>
                    {niches.map((n, i) => (
                      <option key={i} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                {/* Location Filter */}
                <div>
                  <input
                    type="text"
                    placeholder="Filter by Location (e.g. Austin)"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Gap Gaps Dropdown */}
                <div>
                  <select
                    value={gapFilter}
                    onChange={(e) => setGapFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="">All Growth Gaps (Any Issues)</option>
                    <option value="not_responsive">Mobile Rendering Errors</option>
                    <option value="slow_speed">Slow Page Speed Score</option>
                    <option value="Missing Meta Description">Missing Meta Descriptions</option>
                    <option value="No H1 Header Found">Missing H1 Headers</option>
                    <option value="SSL certificate is missing">No SSL Certificate (HTTP)</option>
                  </select>
                </div>

              </div>
            </div>

            {/* Leads Card Grid */}
            {loading ? (
              <div className="flex justify-center items-center py-20 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <div className="flex flex-col items-center gap-3">
                  <Loader className="animate-spin text-emerald-600" size={32} />
                  <span className="text-slate-500 font-medium text-sm">Querying LeadSprout database...</span>
                </div>
              </div>
            ) : leads.length === 0 ? (
              <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <AlertTriangle size={32} className="mx-auto text-amber-500 mb-3" />
                <h3 className="font-bold text-slate-900 text-lg">No matching leads found</h3>
                <p className="text-slate-500 text-sm mt-1">Try loosening your search filters to display more pre-audited targets.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {leads.map((lead) => (
                  <div 
                    key={lead.id} 
                    className={`bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer ${
                      selectedLead?.id === lead.id ? 'ring-2 ring-emerald-500 border-transparent bg-slate-50/50' : 'border-slate-200'
                    }`}
                    onClick={() => { setSelectedLead(lead); setActionError(''); setActionSuccess(''); }}
                  >
                    <div>
                      {/* Top Header Card Info */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border border-slate-200/50">
                            {lead.niche}
                          </span>
                          <h4 className="font-black text-slate-900 text-lg mt-1.5 truncate">{lead.business_name}</h4>
                          <span className="text-xs text-slate-500 font-semibold flex items-center gap-1 mt-0.5">
                            <MapPin size={12} className="text-slate-400 shrink-0" /> {lead.location}
                          </span>
                        </div>

                        {/* PageSpeed Performance Badge */}
                        <div className="flex flex-col items-center shrink-0">
                          <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-black text-sm ${
                            lead.speed_score >= 80 ? 'border-emerald-500 text-emerald-600 bg-emerald-50' :
                            lead.speed_score >= 50 ? 'border-amber-500 text-amber-600 bg-amber-50' :
                            'border-rose-500 text-rose-600 bg-rose-50'
                          }`}>
                            {lead.speed_score}
                          </div>
                          <span className="text-[8px] text-slate-400 font-bold uppercase mt-0.5">Speed</span>
                        </div>
                      </div>

                      {/* Technical Checklists display */}
                      <div className="mt-4 border-t border-slate-100 pt-3.5 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 font-medium">Responsive Viewport:</span>
                          <span className={`font-extrabold flex items-center gap-1 ${lead.responsive_status === 'responsive' ? 'text-emerald-600' : 'text-rose-500'}`}>
                            <Smartphone size={12} />
                            {lead.responsive_status === 'responsive' ? 'Passed' : 'Failed'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 font-medium">SEO Technical Checks:</span>
                          <span className={`font-extrabold ${lead.seo_gaps.length === 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {lead.seo_gaps.length === 0 ? 'Optimal' : `${lead.seo_gaps.length} Gaps Found`}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom CTA Block */}
                    <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between gap-4">
                      {lead.is_unlocked ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5">
                            <CheckCircle size={12} /> Unlocked
                          </div>
                          <span className="text-xs text-slate-500 font-mono truncate">{lead.verified_emails[0]}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-slate-400">
                          <Lock size={12} />
                          <span className="text-xs font-mono">{lead.verified_emails[0]}</span>
                        </div>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (lead.is_unlocked) {
                            setSelectedLead(lead);
                          } else {
                            handleUnlock(lead.id);
                          }
                        }}
                        className={`text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm ${
                          lead.is_unlocked 
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' 
                            : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/10'
                        }`}
                      >
                        {lead.is_unlocked ? 'View Pitch' : 'Unlock Emails'}
                      </button>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Audit details and Generated Pitch panel */}
          <div className="xl:w-[480px] shrink-0">
            {selectedLead ? (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white sticky top-22 shadow-xl space-y-6">
                
                {/* Header detail */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border border-emerald-500/20">
                      {selectedLead.niche}
                    </span>
                    
                    <button 
                      onClick={() => setSelectedLead(null)}
                      className="text-slate-500 hover:text-white text-xs font-semibold"
                    >
                      Clear Focus
                    </button>
                  </div>

                  <h3 className="text-2xl font-black mt-3 truncate">{selectedLead.business_name}</h3>
                  <p className="text-slate-400 text-xs font-medium flex items-center gap-1 mt-1">
                    <MapPin size={12} className="text-slate-500" /> {selectedLead.location} • <a href={`https://${selectedLead.domain}`} target="_blank" rel="noreferrer" className="text-emerald-400 font-bold hover:underline">{selectedLead.domain}</a>
                  </p>
                </div>

                {/* Audit results breakdown */}
                <div className="bg-slate-800/40 border border-slate-800/80 rounded-2xl p-4.5 space-y-3.5">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2">Technical Health Diagnostics</h4>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">PageSpeed Performance Score:</span>
                    <span className={`font-black ${selectedLead.speed_score >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                      {selectedLead.speed_score} / 100
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">Responsive Viewport:</span>
                    <span className={`font-bold ${selectedLead.responsive_status === 'responsive' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {selectedLead.responsive_status === 'responsive' ? 'Responsive Passed' : 'Broken Layout / Fail'}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-slate-400 block mb-2 font-semibold">Identified Web Failure Gaps:</span>
                    {selectedLead.seo_gaps.length === 0 ? (
                      <span className="text-emerald-400 text-sm font-semibold flex items-center gap-1.5"><CheckCircle size={14} /> No failure gaps detected! This is an optimized site.</span>
                    ) : (
                      <div className="space-y-1.5 pl-1">
                        {selectedLead.seo_gaps.map((gap, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-300 font-medium">
                            <span className="w-1.5 h-1.5 bg-rose-500 rounded-full shrink-0" />
                            <span>{gap}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Unlocked Details Frame */}
                {selectedLead.is_unlocked ? (
                  <div className="space-y-4">
                    <div className="bg-slate-800/40 border border-slate-800/80 rounded-2xl p-4.5">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 mb-3">Verified Contact Information</h4>
                      <div className="space-y-2">
                        {selectedLead.verified_emails.map((email, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl px-3.5 py-2.5">
                            <span className="font-mono text-sm text-emerald-300">{email}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(email);
                                alert('Email copied!');
                              }}
                              className="text-slate-500 hover:text-white hover:scale-105 transition-all"
                              title="Copy Email"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Agency & Outreach Sales Toolkit tabbed panel */}
                    <div className="bg-slate-800/40 border border-slate-800/80 rounded-2xl p-4.5 space-y-4">
                      {/* Tab selector header */}
                      <div className="border-b border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Sales Outreach Toolkit</h4>
                        <div className="flex items-center gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-slate-850">
                          <button
                            onClick={() => { setActiveAgencyTab('pitch'); setActionError(''); setActionSuccess(''); }}
                            className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all ${
                              activeAgencyTab === 'pitch' 
                                ? 'bg-slate-800 text-emerald-400 shadow-sm' 
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            Single Pitch
                          </button>
                          
                          <button
                            onClick={() => { setActiveAgencyTab('sequence'); setActionError(''); setActionSuccess(''); }}
                            className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                              activeAgencyTab === 'sequence' 
                                ? 'bg-slate-800 text-emerald-400 shadow-sm' 
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            3-Step Seq
                            {user?.plan !== 'agency' && <Lock size={8} className="text-slate-500" />}
                          </button>

                          <button
                            onClick={() => { setActiveAgencyTab('crm'); setActionError(''); setActionSuccess(''); }}
                            className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                              activeAgencyTab === 'crm' 
                                ? 'bg-slate-800 text-emerald-400 shadow-sm' 
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            CRM Export
                            {user?.plan !== 'agency' && <Lock size={8} className="text-slate-500" />}
                          </button>
                        </div>
                      </div>

                      {/* Display Alert Notifications if present */}
                      {actionSuccess && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3.5 py-2.5 rounded-xl text-xs font-semibold animate-fade-in">
                          {actionSuccess}
                        </div>
                      )}
                      {actionError && (
                        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-3.5 py-2.5 rounded-xl text-xs font-semibold animate-fade-in">
                          {actionError}
                        </div>
                      )}

                      {/* Tab 1 Content: Single Pitch */}
                      {activeAgencyTab === 'pitch' && (
                        pitchLoading ? (
                          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
                            <Loader className="animate-spin text-emerald-400" size={24} />
                            <span className="text-xs">Tailoring custom marketing copy...</span>
                          </div>
                        ) : pitch ? (
                          <div className="space-y-4 text-sm font-sans">
                            {/* Subject */}
                            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Email Subject Line</span>
                                <span className="font-semibold text-white truncate block mt-0.5">{pitch.subject}</span>
                              </div>
                              <button
                                onClick={handleCopySubject}
                                className="text-slate-400 hover:text-white shrink-0 p-1"
                                title="Copy Subject"
                              >
                                {copiedSubject ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                              </button>
                            </div>

                            {/* Body */}
                            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block border-b border-slate-800 pb-1.5 mb-2 font-sans">Email Body Text</span>
                              <pre className="text-slate-300 text-[11px] font-sans whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                                {pitch.body}
                              </pre>
                              <button
                                onClick={handleCopyBody}
                                className="mt-3 self-end flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition-all"
                              >
                                {copiedBody ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy Email Body</>}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 text-center py-6">Could not load email pitch templates.</p>
                        )
                      )}

                      {/* Tab 2 Content: 3-Step Outreach Sequence */}
                      {activeAgencyTab === 'sequence' && (
                        user?.plan !== 'agency' ? (
                          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 text-center space-y-4">
                            <Lock size={24} className="mx-auto text-emerald-500 animate-pulse" />
                            <div>
                              <h5 className="font-bold text-white text-xs">3-Step Sequence Generator Locked</h5>
                              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                Automated multi-step sequences require the <strong>Agency Plan ($149/month)</strong>.
                                Send a highly personalized Initial Pitch, Day 3 Follow-up, and Day 7 breakup email sequence custom-built for this lead.
                              </p>
                              </div>
                              <button
                              onClick={() => navigate('/checkout?plan=agency')}
                              className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs py-2.5 rounded-xl transition-all"
                              >
                              Upgrade to Agency Plan
                              </button>
                              </div>
                        ) : (
                          <div className="space-y-4">
                            {sequenceLoading ? (
                              <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
                                <Loader className="animate-spin text-emerald-400" size={24} />
                                <span className="text-xs">Generating 3-step outreach campaign sequence...</span>
                              </div>
                            ) : !sequence ? (
                              <div className="text-center py-8">
                                <p className="text-xs text-slate-400 max-w-xs mx-auto mb-4 leading-relaxed">
                                  Generate a tailored 3-step follow-up campaign utilizing the marketer's approved follow-up logic to close this prospect.
                                </p>
                                <button
                                  onClick={() => generateSequence(selectedLead.id)}
                                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition-all inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
                                >
                                  <Zap size={12} fill="currentColor" /> Generate 3-Step Sequence
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {/* Step Selectors */}
                                <div className="grid grid-cols-3 gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
                                  {sequence.map((stepItem) => (
                                    <button
                                      key={stepItem.step}
                                      onClick={() => {
                                        setActiveSequenceStep(stepItem.step);
                                        setCopiedSeqSubject(false);
                                        setCopiedSeqBody(false);
                                      }}
                                      className={`text-[9px] font-bold py-2 rounded-lg transition-all ${
                                        activeSequenceStep === stepItem.step 
                                          ? 'bg-slate-800 text-emerald-400' 
                                          : 'text-slate-400 hover:text-white'
                                      }`}
                                    >
                                      Step {stepItem.step} (Day {stepItem.day})
                                    </button>
                                  ))}
                                </div>

                                {/* Active Step Content */}
                                <div className="space-y-3.5 animate-fade-in">
                                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                                        {sequence[activeSequenceStep - 1].type} - Subject Line
                                      </span>
                                      <span className="font-semibold text-white truncate block mt-0.5">
                                        {sequence[activeSequenceStep - 1].subject}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => handleCopySeqSubject(sequence[activeSequenceStep - 1].subject)}
                                      className="text-slate-400 hover:text-white shrink-0 p-1"
                                      title="Copy Subject"
                                    >
                                      {copiedSeqSubject ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                                    </button>
                                  </div>

                                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
                                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block border-b border-slate-800 pb-1.5 mb-2 font-sans">
                                      Outreach Body Template
                                    </span>
                                    <pre className="text-slate-300 text-[11px] font-sans whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                                      {sequence[activeSequenceStep - 1].body}
                                    </pre>
                                    <button
                                      onClick={() => handleCopySeqBody(sequence[activeSequenceStep - 1].body)}
                                      className="mt-3 self-end flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition-all"
                                    >
                                      {copiedSeqBody ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy Body text</>}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      )}

                      {/* Tab 3 Content: CRM Export */}
                      {activeAgencyTab === 'crm' && (
                        user?.plan !== 'agency' ? (
                          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 text-center space-y-4">
                            <Lock size={24} className="mx-auto text-emerald-500 animate-pulse" />
                            <div>
                              <h4 className="font-bold text-white text-sm">CRM Pipelines Locked</h4>
                              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                Seamlessly export unlocked lead data, technical audits, and contact profiles directly to Pipedrive & HubSpot pipelines with the <strong>Agency Plan ($149/month)</strong>.
                              </p>
                              </div>
                              <button
                              onClick={() => navigate('/checkout?plan=agency')}
                              className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs py-2.5 rounded-xl transition-all"
                              >
                              Upgrade to Agency Plan
                              </button>
                              </div>
                        ) : (
                          <div className="space-y-4">
                            <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-1">
                              Simulate exporting this unlocked lead's diagnostics checklist, contact email, location, and niche to your target CRM pipeline.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                              {/* HubSpot Card */}
                              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-inner hover:border-slate-700 transition-all">
                                <div>
                                  <h6 className="font-bold text-xs text-orange-400 uppercase tracking-wider">HubSpot Deals</h6>
                                  <p className="text-[10px] text-slate-400 mt-1">Simulate pushing lead to appointments pipeline stage.</p>
                                </div>
                                <button
                                  onClick={() => handleCRMExport(selectedLead.id, 'hubspot')}
                                  disabled={crmExporting}
                                  className="bg-orange-500 hover:bg-orange-600 text-white font-black text-[10px] py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                >
                                  {crmExporting ? <Loader className="animate-spin" size={10} /> : <><ArrowUpRight size={10} /> Sync HubSpot</>}
                                </button>
                              </div>

                              {/* Pipedrive Card */}
                              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-inner hover:border-slate-700 transition-all">
                                <div>
                                  <h6 className="font-bold text-xs text-emerald-400 uppercase tracking-wider">Pipedrive Sync</h6>
                                  <p className="text-[10px] text-slate-400 mt-1">Export contact data to pipeline stage "contact made".</p>
                                </div>
                                <button
                                  onClick={() => handleCRMExport(selectedLead.id, 'pipedrive')}
                                  disabled={crmExporting}
                                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-[10px] py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                >
                                  {crmExporting ? <Loader className="animate-spin" size={10} /> : <><ArrowUpRight size={10} /> Sync Pipedrive</>}
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-800/40 border border-slate-800/80 rounded-2xl p-6 text-center space-y-4 shadow-inner">
                    <Lock size={28} className="mx-auto text-emerald-500 animate-pulse" />
                    <div>
                      <h4 className="font-bold text-white text-sm">Lead Details Locked</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        To view direct verified contact emails and copy customized outreach pitches, you need to unlock this lead profile.
                      </p>
                    </div>

                    {actionError && (
                      <p className="text-rose-400 text-xs font-semibold bg-rose-500/10 py-2.5 px-3 border border-rose-500/15 rounded-xl">{actionError}</p>
                    )}

                    <button
                      onClick={() => handleUnlock(selectedLead.id)}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-sm py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5"
                    >
                      Unlock Lead Data (1 Credit) <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}

              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center text-slate-500 shadow-sm flex flex-col items-center justify-center py-24 border-dashed sticky top-22">
                <FileText size={40} className="text-slate-300 mb-3" />
                <h4 className="font-bold text-slate-800 text-base">No Lead Selected</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                  Click on any target lead from the board on the left to display their deep performance diagnostics, contact lists, and custom copy pitches.
                </p>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
