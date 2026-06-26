import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Building2, Globe, Link as LinkIcon, 
  Save, Loader, CheckCircle, AlertCircle,
  Briefcase, MessageSquare, Target
} from 'lucide-react';

export default function Agency() {
  const { user, getHeaders, refreshUser, personaConfig } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  const [formData, setFormData] = useState({
    company_name: user?.company_name || '',
    persona: user?.persona || 'web_agency',
    logo_url: user?.logo_url || '',
    calendly_link: user?.calendly_link || ''
  });

  const personas = [
    { id: 'web_agency', label: 'Web Agency' },
    { id: 'freelancer', label: 'Freelancer' },
    { id: 'seo_consultant', label: 'SEO Consultant' },
    { id: 'cold_email_agency', label: 'Cold Email Agency' }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        await refreshUser();
        setMessage({ type: 'success', text: 'Agency identity updated successfully!' });
      } else {
        const data = await res.json();
        setMessage({ type: 'error', text: data.error || 'Failed to update identity' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6 md:space-y-10">
      <header>
        <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-2 md:mb-3">My Agency</h1>
        <p className="text-base md:text-lg text-slate-500 font-medium">Define your business identity. These settings transform your public audit proposals and outreach wording.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-10">
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-8 shadow-sm space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Agency Name</label>
                <input
                  type="text"
                  required
                  value={formData.company_name}
                  onChange={(e) => setFormData({...formData, company_name: e.target.value})}
                  placeholder="e.g. Apex Marketing Group"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Business Persona</label>
                <select
                  value={formData.persona}
                  onChange={(e) => setFormData({...formData, persona: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                >
                  {personas.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logo URL</label>
              <input
                type="url"
                value={formData.logo_url}
                onChange={(e) => setFormData({...formData, logo_url: e.target.value})}
                placeholder="https://your-site.com/logo.png"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
              />
              <p className="text-[10px] text-slate-400 font-medium italic">Recommended: Square logo with transparent background.</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Calendly / Booking Link</label>
              <input
                type="url"
                value={formData.calendly_link}
                onChange={(e) => setFormData({...formData, calendly_link: e.target.value})}
                placeholder="https://calendly.com/your-handle"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
              />
              <p className="text-[10px] text-slate-400 font-medium italic">Prospects will use this link to book strategy calls from your audits.</p>
            </div>

            {message.text && (
              <div className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                <span className="text-sm font-bold">{message.text}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 text-white font-black py-4 rounded-xl md:rounded-2xl transition-all shadow-lg flex items-center justify-center gap-3 text-sm md:text-base"
            >
              {loading ? <Loader className="animate-spin" size={20} /> : <><Save size={20} /> Update Identity</>}
            </button>
          </form>
        </div>

        <div className="space-y-6 md:space-y-8">
          <div className="bg-emerald-500 rounded-2xl md:rounded-[2rem] p-6 md:p-8 text-slate-950 shadow-xl shadow-emerald-500/20">
            <Target size={32} md:size={40} className="mb-4" />
            <h3 className="text-lg md:text-xl font-black mb-2 italic">Active Persona Strategy</h3>
            <p className="text-sm md:text-base font-medium text-emerald-950/80 mb-6 leading-relaxed">
              Your platform is currently optimized for a <strong>{personas.find(p => p.id === formData.persona)?.label}</strong> workflow.
            </p>
            <div className="space-y-4">
              <div className="bg-white/10 p-4 rounded-xl md:rounded-2xl border border-white/10">
                <span className="text-[9px] font-black uppercase tracking-widest block mb-1 opacity-60">Your Sales Pitch</span>
                <p className="text-[10px] md:text-xs font-bold leading-relaxed truncate">"{personaConfig?.sample_pitch}"</p>
              </div>
              <div className="bg-white/10 p-4 rounded-xl md:rounded-2xl border border-white/10">
                <span className="text-[9px] font-black uppercase tracking-widest block mb-1 opacity-60">Audit Priority</span>
                <p className="text-[10px] md:text-xs font-bold">{personaConfig?.audit_priority || 'Technical Performance'}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-8 shadow-sm">
            <h3 className="text-base md:text-lg font-black text-slate-900 mb-6">Preview Template</h3>
            <p className="text-[10px] md:text-xs text-slate-500 mb-6">See how your agency branding and persona look on a public audit proposal.</p>
            <button 
              onClick={() => window.open('/demo/sample-lead', '_blank')}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold py-3 md:py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs md:text-sm"
            >
              <LinkIcon size={18} /> Preview Proposal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
