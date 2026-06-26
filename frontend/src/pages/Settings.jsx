import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Zap, ChevronLeft, Save, Globe, Calendar, User, 
  Image, Loader, CheckCircle, AlertTriangle
} from 'lucide-react';

export default function Settings() {
  const navigate = useNavigate();
  const { user, getHeaders, refreshUser } = useAuth();

  const [formData, setFormData] = useState({
    company_name: '',
    logo_url: '',
    calendly_link: '',
    persona: 'web_agency'
  });

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  // CRM Integration State
  const [crmStatus, setCrmStatus] = useState(null);

  const fetchCRMStatus = async () => {
    try {
      const res = await fetch('/api/crm/status', {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setCrmStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch CRM status:', err);
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setFetching(true);
        const res = await fetch('/api/users/profile', {
          headers: getHeaders()
        });
        const data = await res.json();
        if (res.ok) {
          setFormData({
            company_name: data.user.company_name || '',
            logo_url: data.user.logo_url || '',
            calendly_link: data.user.calendly_link || '',
            persona: data.user.persona || 'web_agency'
          });
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setFetching(false);
      }
    };

    fetchProfile();
    fetchCRMStatus();

    // Check for CRM connection redirect flags in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('crm_connected') === 'hubspot') {
      setMessage({ type: 'success', text: 'HubSpot connected successfully!' });
    } else if (params.get('crm_error')) {
      setMessage({ type: 'error', text: 'Failed to connect CRM account. Please try again.' });
    }
  }, []);

  const handleConnectHubSpot = async () => {
    try {
      const res = await fetch('/api/crm/hubspot/connect', {
        headers: getHeaders()
      });
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url; // Redirect to HubSpot OAuth
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Could not initiate HubSpot connection.' });
    }
  };

  const handleDisconnectHubSpot = async () => {
    if (!window.confirm('Are you sure you want to disconnect HubSpot? Lead syncing will be disabled.')) return;

    try {
      const res = await fetch('/api/crm/hubspot/disconnect', {
        method: 'POST',
        headers: getHeaders()
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'HubSpot disconnected successfully.' });
        fetchCRMStatus();
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to disconnect HubSpot.' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: 'success', text: 'Profile updated successfully!' });
        await refreshUser();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update profile.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const personas = [
    { id: 'web_agency', name: 'Web Agency' },
    { id: 'freelancer', name: 'Freelancer' },
    { id: 'seo_consultant', name: 'SEO Consultant' },
    { id: 'cold_email_agency', name: 'Cold Email Agency' }
  ];

  if (fetching) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center">
        <Loader className="animate-spin text-emerald-600 mb-4" size={32} />
        <p className="text-slate-500 font-medium">Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/dashboard')}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-500"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-500 text-slate-950 p-1 rounded-lg">
              <Zap size={16} fill="currentColor" />
            </div>
            <h1 className="font-black text-xl text-slate-900">Account Settings</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded-md border border-slate-200">
            Tier: {user?.plan}
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 lg:p-12 py-10">
        <div className="mb-10">
          <h2 className="text-3xl font-black text-slate-900 mb-2">White-Label Branding</h2>
          <p className="text-slate-500 font-medium">
            Customize how your diagnostic audits and proposals appear to potential clients. 
            This information will be displayed on all your public audit links.
          </p>
        </div>

        {message.text && (
          <div className={`mb-8 p-4 rounded-2xl border flex items-center gap-3 animate-fade-in ${
            message.type === 'success' 
              ? 'bg-emerald-50 border-emerald-100 text-emerald-700' 
              : 'bg-rose-50 border-rose-100 text-rose-700'
          }`}>
            {message.type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            <span className="font-bold text-sm">{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Section: General */}
          <section className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Globe size={14} /> Agency Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Marketing Group"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <User size={14} /> Business Persona
                </label>
                <select
                  value={formData.persona}
                  onChange={(e) => setFormData({ ...formData, persona: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium transition-all"
                >
                  {personas.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 italic">This controls the conversion-focused CTAs shown on your audit pages.</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Image size={14} /> Logo URL (SVG or Transparent PNG)
              </label>
              <input
                type="url"
                placeholder="https://your-site.com/logo.png"
                value={formData.logo_url}
                onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium transition-all"
              />
              <p className="text-[10px] text-slate-400 italic">Provide a public URL to your agency logo. Recommended size: 200x200px.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Calendar size={14} /> Calendly / Booking Link
              </label>
              <input
                type="url"
                placeholder="https://calendly.com/your-handle"
                value={formData.calendly_link}
                onChange={(e) => setFormData({ ...formData, calendly_link: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium transition-all"
              />
              <p className="text-[10px] text-slate-400 italic">Your "Book Review" buttons will link here to drive appointments.</p>
            </div>
          </section>

          {/* CRM Integration Section */}
          <section className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
            <div>
              <h3 className="text-xl font-black text-slate-900 mb-1">CRM Integrations</h3>
              <p className="text-xs text-slate-500 font-medium">Connect your CRM to sync leads directly to your sales pipeline.</p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#ff7a59] rounded-xl flex items-center justify-center text-white">
                  <Zap size={24} fill="currentColor" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900">HubSpot</h4>
                  {crmStatus?.hubspot?.connected ? (
                    <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                      <CheckCircle size={10} /> Connected (Portal ID: {crmStatus.hubspot.portalId})
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500 font-medium">Not connected</p>
                  )}
                </div>
              </div>

              {crmStatus?.hubspot?.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnectHubSpot}
                  className="bg-white border border-slate-200 hover:border-rose-200 hover:text-rose-600 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl transition-all"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectHubSpot}
                  className="bg-[#ff7a59] hover:bg-[#ff8f73] text-white font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-orange-500/10"
                >
                  Connect HubSpot
                </button>
              )}
            </div>
          </section>


          <div className="flex items-center justify-end gap-4">
            <Link 
              to="/dashboard"
              className="text-slate-500 hover:text-slate-900 font-bold text-sm px-6 py-3 transition-all"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-black px-8 py-3.5 rounded-2xl transition-all flex items-center gap-2 shadow-xl shadow-emerald-500/10"
            >
              {loading ? <Loader className="animate-spin" size={18} /> : <Save size={18} />}
              Save Profile Changes
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
