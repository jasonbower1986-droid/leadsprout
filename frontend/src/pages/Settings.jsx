import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  CreditCard, Shield, Bell, 
  ExternalLink, Key, Zap,
  CheckCircle, Loader
} from 'lucide-react';

export default function Settings() {
  const { user, getHeaders } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleHubSpotConnect = () => {
    // Phase 2 implementation
    alert('HubSpot integration will be activated in Phase 2.');
  };

  return (
    <div className="max-w-4xl space-y-6 md:space-y-10">
      <header>
        <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-2 md:mb-3">Settings</h1>
        <p className="text-base md:text-lg text-slate-500 font-medium">Manage your subscription, security, and technical integrations.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        <div className="bg-white border border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 md:p-2.5 bg-emerald-100 text-emerald-600 rounded-xl"><CreditCard size={20} md:size={24} /></div>
            <h3 className="text-lg md:text-xl font-black text-slate-900">Subscription</h3>
          </div>
          
          <div className="bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl p-4 md:p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Current Plan</span>
                <span className="text-xl md:text-2xl font-black text-slate-900 uppercase">{user?.plan}</span>
              </div>
              <span className="bg-emerald-500 text-slate-950 text-[9px] md:text-[10px] font-black px-2 py-1 rounded-lg uppercase">Active</span>
            </div>
            <div className="space-y-2">
               <div className="flex justify-between text-[10px] md:text-xs font-bold">
                 <span className="text-slate-400">Monthly Credits</span>
                 <span className="text-slate-900">{user?.plan === 'agency' ? 'Unlimited' : user?.max_credits}</span>
               </div>
               <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                 <div className="bg-emerald-500 h-full" style={{ width: user?.plan === 'agency' ? '100%' : `${(user?.unlocks_count / user?.max_credits) * 100}%` }} />
               </div>
            </div>
          </div>

          <button className="w-full bg-slate-900 text-white font-bold py-3 md:py-3.5 rounded-xl hover:bg-slate-800 transition-all flex items-center justify-center gap-2 text-sm md:text-base">
            <ExternalLink size={16} md:size={18} /> Manage in Stripe
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 md:p-2.5 bg-orange-100 text-orange-600 rounded-xl"><Zap size={20} md:size={24} /></div>
            <h3 className="text-lg md:text-xl font-black text-slate-900">Integrations</h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 md:w-10 md:h-10 bg-white rounded-lg border border-slate-200 flex items-center justify-center shrink-0">
                   <img src="https://www.vectorlogo.zone/logos/hubspot/hubspot-icon.svg" className="w-5 h-5 md:w-6 md:h-6" alt="HubSpot" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs md:text-sm font-black text-slate-900">HubSpot CRM</h4>
                  <p className="text-[9px] md:text-[10px] text-slate-500 font-medium truncate">Export leads to your pipeline.</p>
                </div>
              </div>
              <button 
                onClick={handleHubSpotConnect}
                className="text-[10px] md:text-xs font-black text-orange-600 hover:underline shrink-0"
              >
                Connect
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl opacity-50">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 md:w-10 md:h-10 bg-white rounded-lg border border-slate-200 flex items-center justify-center shrink-0">
                   <img src="https://www.vectorlogo.zone/logos/pipedrive/pipedrive-icon.svg" className="w-5 h-5 md:w-6 md:h-6" alt="Pipedrive" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs md:text-sm font-black text-slate-900">Pipedrive</h4>
                  <p className="text-[9px] md:text-[10px] text-slate-500 font-medium truncate">Coming soon.</p>
                </div>
              </div>
              <span className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase shrink-0">Disabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
