import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  Zap, MapPin, CheckCircle, Smartphone, Loader, Copy,
  ArrowUpRight, FileText, AlertTriangle, ChevronLeft
} from 'lucide-react';

export default function AuditDemo() {
  const { leadId } = useParams();
  const [lead, setLead] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDemoLead = async () => {
      try {
        setLoading(true);
        // Look for persona in query params to tailor the demo
        const searchParams = new URLSearchParams(window.location.search);
        const persona = searchParams.get('persona') || '';
        const userId = searchParams.get('userId') || '';
        
        const res = await fetch(`/api/leads/demo/${leadId}?persona=${persona}&userId=${userId}`);
        const data = await res.json();
        
        if (res.ok) {
          setLead(data.lead);
          setNarrative(data.sales_narrative);
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
  }, [leadId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center text-white p-6">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 font-medium animate-pulse">Loading LeadSprout Audit Demo...</p>
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
      {/* Public Header */}
      <header className="bg-white border-b border-slate-200 h-20 flex items-center justify-between px-6 lg:px-12 sticky top-0 z-30">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="bg-emerald-500 text-slate-950 p-1.5 rounded-xl flex items-center justify-center">
            <Zap size={20} fill="currentColor" />
          </div>
          <span className="font-extrabold text-2xl tracking-tight text-slate-900">LeadSprout</span>
        </Link>
        
        <div className="hidden sm:flex items-center gap-6">
          <span className="text-sm font-bold text-slate-500 uppercase tracking-widest bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">Agency Audit Demo</span>
          <Link to="/register" className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all">
            Get 50 Free Leads
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 lg:p-12 py-10 lg:py-16">
        {/* Welcome Callout */}
        <div className="bg-emerald-500 rounded-3xl p-8 lg:p-10 mb-10 text-slate-950 relative overflow-hidden shadow-xl shadow-emerald-500/10">
          <div className="relative z-10">
            <h1 className="text-3xl lg:text-4xl font-black mb-4">Sample Agency Gift: {lead.business_name}</h1>
            <p className="text-lg font-medium text-emerald-950/80 max-w-2xl leading-relaxed">
              We've generated this technical audit and contact profile using LeadSprout. 
              Agencies use these data-backed insights to break through the noise and close high-intent prospects daily.
            </p>
          </div>
          <div className="absolute top-0 right-0 p-10 opacity-10 -rotate-12 translate-x-10 -translate-y-10">
            <Zap size={240} fill="currentColor" />
          </div>
        </div>

        {/* Diagnostic Narrative Insight */}
        {narrative && (
          <div className="mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="bg-white border-l-4 border-emerald-500 rounded-2xl p-8 shadow-sm overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <FileText size={120} />
              </div>
              <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                <CheckCircle size={14} /> Diagnostic Executive Summary
              </h3>
              <p className="text-xl text-slate-800 font-medium leading-relaxed mb-0 relative z-10" dangerouslySetInnerHTML={{ 
                __html: narrative.executive_summary.replace(/\*\*(.*?)\*\*/g, '<span class="font-black text-slate-900">$1</span>') 
              }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Main Audit Content */}
          <div className="lg:col-span-3 space-y-8">
            <section className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <FileText size={20} className="text-emerald-500" /> Technical Health Report
                </h2>
                <span className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border border-slate-200">
                  {lead.niche}
                </span>
              </div>

              <div className="space-y-6">
                {/* Score Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-center">
                    <div className={`text-4xl font-black mb-1 ${
                      lead.speed_score >= 80 ? 'text-emerald-500' :
                      lead.speed_score >= 50 ? 'text-amber-500' :
                      'text-rose-500'
                    }`}>
                      {lead.speed_score}
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Performance Score</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-center">
                    <div className={`text-4xl font-black mb-1 ${
                      lead.responsive_status === 'responsive' ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {lead.responsive_status === 'responsive' ? 'PASS' : 'FAIL'}
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Mobile Responsive</span>
                  </div>
                </div>

                {/* Gaps List */}
                <div className="bg-slate-900 rounded-2xl p-6 text-white">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-800 pb-2">Identified Website Failure Gaps</h3>
                  <div className="space-y-3">
                    {lead.seo_gaps.map((gap, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm font-medium">
                        <div className="w-5 h-5 bg-rose-500/20 border border-rose-500/30 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                          <div className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
                        </div>
                        <span className="text-slate-200 leading-relaxed">{gap}</span>
                      </div>
                    ))}
                    {lead.seo_gaps.length === 0 && (
                      <div className="flex items-center gap-3 text-emerald-400 font-bold text-sm">
                        <CheckCircle size={18} /> No critical gaps detected.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* CTA for Agency */}
            <section className="bg-slate-900 rounded-3xl p-8 text-white shadow-xl">
              <h3 className="text-xl font-black mb-2">Want 250 leads like this?</h3>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                LeadSprout automates the tedious research process. We scan 10,000+ local businesses daily to find the ones with 
                demonstrable technical failures that you can fix.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/register" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                  Start Your Free Trial <ArrowUpRight size={18} />
                </Link>
                <Link to="/" className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-3 rounded-xl transition-all flex items-center justify-center">
                  Learn How It Works
                </Link>
              </div>
            </section>
          </div>

          {/* Sidebar Info */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-100 pb-2">Business Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Company Name</label>
                  <div className="font-bold text-slate-900">{lead.business_name}</div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Primary Domain</label>
                  <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer" className="font-bold text-emerald-600 hover:underline flex items-center gap-1">
                    {lead.domain} <ArrowUpRight size={12} />
                  </a>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Location</label>
                  <div className="font-bold text-slate-900 flex items-center gap-1">
                    <MapPin size={14} className="text-slate-400" /> {lead.location}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-100 pb-2">Verified Contacts</h3>
              <div className="space-y-3">
                {lead.verified_emails.map((email, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                    <span className="font-mono text-xs text-slate-700 font-bold">{email}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(email);
                        alert('Email copied!');
                      }}
                      className="text-slate-400 hover:text-emerald-500 transition-all"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 italic text-center mt-2">
                  Pro & Agency accounts receive verified decision-maker emails for every lead.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-12 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-6 grayscale">
            <div className="bg-slate-400 text-white p-1 rounded-lg">
              <Zap size={14} fill="currentColor" />
            </div>
            <span className="font-extrabold text-xl tracking-tight text-slate-400">LeadSprout</span>
          </div>
          <p className="text-sm text-slate-400 mb-8 max-w-md mx-auto">
            The automated lead intelligence platform for modern agencies and freelancers. 
            Stop hunting, start closing.
          </p>
          <div className="flex justify-center gap-8 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <Link to="/" className="hover:text-emerald-500">Home</Link>
            <Link to="/login" className="hover:text-emerald-500">Log In</Link>
            <Link to="/register" className="hover:text-emerald-500">Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
