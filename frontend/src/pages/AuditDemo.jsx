import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { 
  Zap, MapPin, CheckCircle, Smartphone, Loader, Copy,
  ArrowUpRight, FileText, AlertTriangle, ChevronLeft,
  Calendar, ShieldCheck, MousePointerClick, TrendingDown,
  Quote, Trophy
} from 'lucide-react';

export default function AuditDemo() {
  const { leadId } = useParams();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const viaUserId = queryParams.get('via') || queryParams.get('userId');
  const queryPersona = queryParams.get('persona');

  const [lead, setLead] = useState(null);
  const [branding, setBranding] = useState({
    company_name: 'LeadSprout',
    logo_url: null,
    calendly_link: 'https://calendly.com/leadsprout-demo',
    persona: 'web_agency'
  });
  const [personaDetails, setPersonaDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const ctaMap = {
    web_agency: "Book a Website Audit Review",
    freelancer: "Claim this Project Roadmap",
    seo_consultant: "Review the SEO Technical Roadmap",
    cold_email_agency: "Generate Custom Outreach Sequence"
  };

  useEffect(() => {
    const fetchDemoLead = async () => {
      try {
        setLoading(true);
        // Construct URL with available context
        let url = `/api/leads/demo/${leadId}?`;
        if (viaUserId) url += `via=${viaUserId}&`;
        if (queryPersona) url += `persona=${queryPersona}&`;
          
        const res = await fetch(url);
        const data = await res.json();
        
        if (res.ok) {
          setLead(data.lead);
          if (data.branding) {
            setBranding(data.branding);
          }
          if (data.personaDetails) {
            setPersonaDetails(data.personaDetails);
          }
        } else {
          setError(data.error || 'Failed to load audit demo.');
        }
      } catch (err) {
        console.error('Failed to fetch demo lead:', err);
        setError('Network error loading audit demo.');
      } finally {
        setLoading(false);
      }
    };

    if (leadId) {
      fetchDemoLead();
    }
  }, [leadId, viaUserId, queryPersona]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center text-white p-6">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 font-medium animate-pulse">Loading Audit Report...</p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center text-white p-6 text-center">
        <AlertTriangle size={48} className="text-rose-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Audit Not Found</h1>
        <p className="text-slate-400 max-w-md mb-8">{error || "The requested audit report could not be located in our database."}</p>
        <Link to="/" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-6 py-3 rounded-xl transition-all flex items-center gap-2">
          <ChevronLeft size={18} /> Return to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* White-Label Header */}
      <header className="bg-white border-b border-slate-200 h-20 flex items-center justify-between px-6 lg:px-12 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={branding.company_name} className="h-10 w-auto rounded-lg" />
          ) : (
            <div className="bg-emerald-500 text-slate-950 p-1.5 rounded-xl flex items-center justify-center">
              <Zap size={20} fill="currentColor" />
            </div>
          )}
          <span className="font-extrabold text-2xl tracking-tight text-slate-900">{branding.company_name}</span>
        </div>
        
        <div className="hidden sm:flex items-center gap-6">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            Performance Audit
          </span>
          <a 
            href={branding.calendly_link}
            target="_blank"
            rel="noreferrer"
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all flex items-center gap-2"
          >
            <Calendar size={16} /> Book Review
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 lg:p-12 py-10 lg:py-16">
        {/* Welcome Callout */}
        <div className="bg-slate-900 rounded-[2rem] p-8 lg:p-12 mb-12 text-white relative overflow-hidden shadow-2xl">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6">
              <ShieldCheck size={14} /> Priority Technical Audit
            </div>
            <h1 className="text-3xl lg:text-5xl font-black mb-6 leading-tight">
              Growth Potential for <span className="text-emerald-400">{lead.business_name}</span>
            </h1>
            
            {/* Persona Summary Narrative */}
            <p className="text-lg lg:text-xl font-medium text-slate-400 max-w-3xl leading-relaxed">
              {lead.persona_summary || personaDetails?.voice_and_tone?.onboarding_message || `We've performed a deep-scan of your digital infrastructure. This report from ${branding.company_name} highlights the critical technical and conversion gaps currently impacting your customer acquisition.`}
            </p>

            {lead.revenue_leak?.monthly_revenue_leak > 0 && (
              <div className="mt-8 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <div className="text-rose-400 font-bold text-xs uppercase tracking-widest mb-1">Estimated Revenue Leak</div>
                  <div className="text-4xl font-black text-white">{lead.revenue_leak.formatted_leak}<span className="text-lg text-rose-400/60 font-medium italic"> / month</span></div>
                </div>
                <div className="max-w-md text-sm text-slate-300 italic">
                  "Based on {lead.niche} industry benchmarks, technical friction is currently costing your business ~{lead.revenue_leak.loss_count} customers every month."
                </div>
              </div>
            )}

            {/* Advisor Quote */}
            {lead.advisor_quote && (
              <div className="mt-8 bg-emerald-500/10 border-l-4 border-emerald-500 p-6 rounded-r-2xl relative">
                <Quote className="absolute top-4 right-6 text-emerald-500/20" size={40} />
                <div className="text-emerald-400 font-bold text-sm uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Zap size={14} fill="currentColor" /> Strategic Recommendation
                </div>
                <p className="text-white italic text-lg leading-relaxed relative z-10">
                  "{lead.advisor_quote}"
                </p>
              </div>
            )}
          </div>
          <div className="absolute top-0 right-0 p-10 opacity-5 -rotate-12 translate-x-10 -translate-y-10">
            <Zap size={320} fill="currentColor" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Audit Content */}
          <div className="lg:col-span-2 space-y-8">
            <section className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <FileText size={20} className="text-emerald-500" /> Technical Health Report
                </h2>
                <span className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border border-slate-200">
                  {lead.niche}
                </span>
              </div>

              <div className="space-y-8">
                {/* Advisor Insights Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Visibility Health (formerly SEO Score) */}
                  <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Visibility Health</span>
                        <div className={`text-5xl font-black ${
                          lead.visibility_health >= 80 ? 'text-emerald-500' :
                          lead.visibility_health >= 50 ? 'text-amber-500' :
                          'text-rose-500'
                        }`}>
                          {lead.visibility_health || lead.speed_score}
                        </div>
                      </div>
                      <div className="bg-white shadow-sm border border-slate-100 w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-black text-slate-900">
                        {lead.health_grade || 'B'}
                      </div>
                    </div>
                    {lead.market_standing && (
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                        <Trophy size={12} className="text-amber-500" /> {lead.market_standing.sentence}
                      </p>
                    )}
                  </div>

                  {/* Revenue Leak Estimator */}
                  <div className="bg-rose-50 border border-rose-100 rounded-3xl p-6 relative overflow-hidden">
                    <span className="text-[10px] text-rose-400 font-bold uppercase tracking-widest block mb-1 text-right">Revenue Leak</span>
                    <div className="flex items-center gap-4">
                      <div className="bg-rose-500 text-white w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
                        <TrendingDown size={24} />
                      </div>
                      <div>
                        <div className="text-2xl font-black text-rose-600">
                          {lead.revenue_leak?.formatted_leak || '$2.4k'}
                        </div>
                        <p className="text-[10px] font-bold text-rose-400 uppercase tracking-tight">Projected Monthly Drain</p>
                      </div>
                    </div>
                    {lead.revenue_leak && (
                      <p className="mt-4 text-xs font-medium text-rose-700/80 leading-relaxed">
                        Technical friction is costing you approximately {lead.revenue_leak.loss_percentage}% of your digital conversion potential.
                      </p>
                    )}
                  </div>
                </div>

                {/* Score Grid */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 text-center">
                    <div className={`text-4xl font-black mb-1 ${
                      lead.speed_score >= 80 ? 'text-emerald-500' :
                      lead.speed_score >= 50 ? 'text-amber-500' :
                      'text-rose-500'
                    }`}>
                      {lead.speed_score}
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Loading Friction</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 text-center">
                    <div className={`text-4xl font-black mb-1 ${
                      lead.responsive_status === 'responsive' ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {lead.responsive_status === 'responsive' ? 'PASS' : 'FAIL'}
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Mobile Accessibility</span>
                  </div>
                </div>

                {/* Gaps List */}
                <div className="space-y-6">
                  <div className="bg-slate-900 rounded-3xl p-8 text-white">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-800 pb-3 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-rose-500" /> Search Hooks & Visibility
                    </h3>
                    <div className="space-y-4">
                      {lead.seo_gaps.map((gap, i) => {
                        const gapName = typeof gap === 'object' ? gap.name : gap;
                        const impact = typeof gap === 'object' ? gap.impact : 'High';
                        return (
                          <div key={i} className="flex items-start gap-4 text-sm font-medium group">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                              impact === 'High' ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-amber-500/10 border border-amber-500/20'
                            }`}>
                              <div className={`w-2 h-2 rounded-full ${impact === 'High' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-slate-300 leading-relaxed">{gapName}</span>
                              {typeof gap === 'object' && gap.category && (
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mt-1">{gap.category} • {gap.difficulty} Difficulty</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-emerald-950 rounded-3xl p-8 text-white border border-emerald-500/20">
                    <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-6 border-b border-emerald-500/20 pb-3 flex items-center gap-2">
                      <MousePointerClick size={14} className="text-emerald-400" /> Growth & Conversion Leaks
                    </h3>
                    <div className="space-y-4">
                      {lead.conversion_gaps && lead.conversion_gaps.length > 0 ? (
                        lead.conversion_gaps.map((gap, i) => {
                          const gapName = typeof gap === 'object' ? gap.name : gap;
                          return (
                            <div key={i} className="flex items-start gap-4 text-sm font-medium group">
                              <div className="w-6 h-6 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-emerald-500/20 transition-colors">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                              </div>
                              <span className="text-emerald-50 leading-relaxed">{gapName}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex items-center gap-3 text-emerald-400 font-bold text-sm">
                          <CheckCircle size={18} /> No conversion leaks found.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* CTA for Prospect */}
            <section className="bg-emerald-500 rounded-[2rem] p-10 text-slate-950 shadow-xl shadow-emerald-500/20 flex flex-col items-center text-center">
              <h3 className="text-2xl lg:text-3xl font-black mb-4">Fix Your Technical Foundation</h3>
              <p className="text-emerald-950/80 font-medium mb-8 max-w-xl leading-relaxed">
                These technical failures are preventing you from scaling. Let's review the roadmap 
                together and plug these leaks to improve your conversion rate immediately.
              </p>
              <a 
                href={branding.calendly_link}
                target="_blank"
                rel="noreferrer"
                className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-8 py-4 rounded-2xl transition-all flex items-center gap-3 text-lg shadow-lg"
              >
                {personaDetails?.proposal_cta || ctaMap[branding.persona] || ctaMap.web_agency} <ArrowUpRight size={20} />
              </a>
            </section>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-3">Business Profile</h3>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Company Name</label>
                  <div className="font-bold text-slate-900 text-lg">{lead.business_name}</div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Target Domain</label>
                  <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer" className="font-bold text-emerald-600 hover:underline flex items-center gap-1.5">
                    {lead.domain} <ArrowUpRight size={14} />
                  </a>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Location</label>
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <MapPin size={16} className="text-slate-400" /> {lead.location}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm overflow-hidden">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-3 text-center lg:text-left">Agency Contact</h3>
              <div className="flex flex-col items-center lg:items-start">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-inner">
                   {branding.logo_url ? (
                    <img src={branding.logo_url} alt={branding.company_name} className="w-10 h-auto" />
                  ) : (
                    <Zap size={24} className="text-emerald-500" />
                  )}
                </div>
                <div className="font-black text-slate-900 mb-1">{branding.company_name}</div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Verified Partner</div>
                
                <a 
                  href={branding.calendly_link}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-900 font-bold px-4 py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Calendar size={16} /> Schedule a Call
                </a>
              </div>
            </div>

            {/* Powered by Badge */}
            <div className="flex flex-col items-center py-6 opacity-30 grayscale hover:opacity-100 hover:grayscale-0 transition-all">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Powered By</p>
              <div className="flex items-center gap-2">
                <div className="bg-slate-900 text-white p-1 rounded-md">
                  <Zap size={10} fill="currentColor" />
                </div>
                <span className="font-black text-sm tracking-tight text-slate-900 italic">LeadSprout</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
