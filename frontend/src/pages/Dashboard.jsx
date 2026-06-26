import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Zap, ArrowRight, TrendingUp, Users,
  Search, CheckCircle, Clock, Loader,
  AlertCircle
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, getHeaders, personaConfig } = useAuth();
  const [stats, setStats] = useState({
    totalLeads: 0,
    unlockedLeads: 0,
    recentLeads: [],
    criticalLeads: []
  });
  const [loading, setLoading] = useState(true);
  const [analyzeUrl, setAnalyzeUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/leads', { headers: getHeaders() });
        if (res.ok) {
          const data = await res.json();
          setStats({
            totalLeads: data.length,
            unlockedLeads: data.filter(l => l.is_unlocked).length,
            recentLeads: data.slice(0, 5),
            criticalLeads: data.filter(l => l.speed_score < 40 || l.responsive_status !== 'responsive').slice(0, 3)
          });
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, []);

  const handleAnalyzeSite = async () => {
    if (!analyzeUrl) return;
    try {
      setIsAnalyzing(true);
      setMessage({ type: '', text: '' });
      const res = await fetch('/api/leads/analyze', {
        method: 'POST',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: analyzeUrl })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'Analysis complete! Lead added to your database.' });
        setAnalyzeUrl('');
        const refreshRes = await fetch('/api/leads', { headers: getHeaders() });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setStats(prev => ({ ...prev, totalLeads: refreshData.length }));
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to analyze site.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Connection error. Please try again.' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader className="animate-spin text-emerald-500" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-10">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-2 md:mb-3">Welcome Back</h1>
          <p className="text-base md:text-lg text-slate-500 font-medium">Here is your revenue opportunity for today.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl md:rounded-2xl px-4 md:px-6 py-3 md:py-4 shadow-sm inline-block self-start md:self-auto">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Available Credits</span>
          <span className="text-2xl md:text-3xl font-black text-slate-900">
            {user?.plan === 'agency' ? '∞' : user?.unlocks_count || 0}
          </span>
        </div>
      </header>

      <div className="bg-slate-900 rounded-2xl md:rounded-[2rem] p-6 md:p-12 text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl md:text-3xl font-black mb-2">Analyze a New Prospect</h2>
          <p className="text-slate-400 text-sm md:text-base font-medium mb-6 md:mb-8 max-w-xl">
            Enter any business website URL to run an instant technical SEO and conversion audit.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 md:left-6 top-1/2 -translate-y-1/2 text-slate-500" size={20} md:size={24} />
              <input
                type="text"
                value={analyzeUrl}
                onChange={(e) => setAnalyzeUrl(e.target.value)}
                placeholder="https://example-business.com"
                className="w-full bg-slate-800/50 border-2 border-slate-700/50 rounded-xl md:rounded-2xl py-4 md:py-5 pl-12 md:pl-16 pr-4 md:pr-6 text-base md:text-lg focus:border-emerald-500 focus:outline-none transition-all placeholder:text-slate-600"
              />
            </div>
            <button
              onClick={handleAnalyzeSite}
              disabled={isAnalyzing || !analyzeUrl}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 text-slate-950 font-black px-6 md:px-10 py-4 md:py-5 rounded-xl md:rounded-2xl text-base md:text-lg transition-all flex items-center justify-center gap-3"
            >
              {isAnalyzing ? <Loader className="animate-spin" size={24} /> : 'Run Audit'}
            </button>
          </div>
          {message.text && (
            <p className={`mt-4 text-sm font-bold flex items-center gap-2 ${message.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {message.text}
            </p>
          )}
        </div>
        <div className="absolute top-0 right-0 p-12 opacity-5 -rotate-12 translate-x-10 -translate-y-10 hidden md:block">
          <Zap size={240} fill="currentColor" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-10">
        <div className="lg:col-span-2 space-y-6 md:space-y-10">
          <div className="bg-white border border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <h3 className="text-lg md:text-xl font-black text-slate-900 flex items-center gap-2">
                <Clock size={20} className="text-emerald-500" /> Recent Leads
              </h3>
              <button
                onClick={() => navigate('/leads')}
                className="text-xs md:text-sm font-bold text-emerald-600 hover:underline flex items-center gap-1"
              >
                View All <ArrowRight size={16} />
              </button>
            </div>
            <div className="space-y-4">
              {stats.recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => navigate('/leads')}
                  className="group flex items-center justify-between p-3 md:p-4 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded-xl md:rounded-2xl transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-lg md:rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-emerald-500 transition-colors">
                      <Users size={20} md:size={24} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 group-hover:text-emerald-600 transition-colors truncate text-sm md:text-base">{lead.business_name}</h4>
                      <p className="text-[10px] md:text-xs text-slate-400 font-medium truncate">{lead.niche} • {lead.location}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 md:gap-6">
                    <div className="text-right hidden sm:block">
                      <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Audit Score</span>
                      <span className={`font-black text-xs md:text-base ${lead.speed_score >= 80 ? 'text-emerald-500' : lead.speed_score >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>
                        {lead.speed_score}/100
                      </span>
                    </div>
                    <ArrowRight size={18} md:size={20} className="text-slate-300 group-hover:text-emerald-500 transition-all transform group-hover:translate-x-1 shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6 md:space-y-10">
          <div className="bg-emerald-500 rounded-2xl md:rounded-[2rem] p-6 md:p-8 text-slate-950 shadow-xl shadow-emerald-500/20">
            <TrendingUp size={32} md:size={40} className="mb-4" />
            <h3 className="text-xl md:text-2xl font-black mb-2">Revenue Alert</h3>
            <p className="text-sm md:text-base font-medium text-emerald-950/70 mb-6 md:mb-8 leading-relaxed">
              You have <strong>{stats.totalLeads} pre-audited prospects</strong> with critical technical gaps.
            </p>
            <button
              onClick={() => navigate('/leads')}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black py-3.5 md:py-4 rounded-xl md:rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm md:text-base"
            >
              {personaConfig?.dashboard_cta || 'Find Leads to Close'} <Search size={18} md:size={20} />
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-8 shadow-sm">
            <h3 className="text-base md:text-lg font-black text-slate-900 mb-6">Immediate Actions</h3>
            <div className="space-y-6">
              <div className="flex gap-3 md:gap-4">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xs md:text-sm shrink-0">1</div>
                <div>
                  <h4 className="font-bold text-slate-900 text-xs md:text-sm">Perfect your Agency Brand</h4>
                  <p className="text-[10px] md:text-xs text-slate-500 mt-1">Ensure your logo and persona are set in the Agency section.</p>
                  <button onClick={() => navigate('/agency')} className="text-[10px] md:text-xs font-bold text-emerald-600 mt-2 hover:underline">Go to Agency</button>
                </div>
              </div>
              <div className="flex gap-3 md:gap-4">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xs md:text-sm shrink-0">2</div>
                <div>
                  <h4 className="font-bold text-slate-900 text-xs md:text-sm">Review New Gaps</h4>
                  <p className="text-[10px] md:text-xs text-slate-500 mt-1">Check the newest leads for high-value technical failures.</p>
                  <button onClick={() => navigate('/leads')} className="text-[10px] md:text-xs font-bold text-emerald-600 mt-2 hover:underline">Browse Leads</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
