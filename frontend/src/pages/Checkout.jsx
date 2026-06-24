import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Zap, CheckCircle, ArrowRight, Loader, Shield, Lock, CreditCard } from 'lucide-react';

export default function Checkout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, getHeaders, refreshUser } = useAuth();
  
  const [selectedPlan, setSelectedPlan] = useState(searchParams.get('plan') || 'pro');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const plans = {
    basic: { name: 'Basic Plan', price: '$29', limit: '50 leads/mo' },
    pro: { name: 'Pro Plan', price: '$79', limit: '250 leads/mo' },
    agency: { name: 'Agency Plan', price: '$149', limit: 'Unlimited' }
  };

  const handleCheckout = async () => {
    try {
      setLoading(true);
      setError('');

      if (!user) {
        navigate('/login?redirect=/checkout');
        return;
      }

      const res = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ plan: selectedPlan })
      });

      const data = await res.json();

      if (res.ok) {
        // In a real app: window.location.href = data.url;
        // In our mock: we trigger the webhook immediately and redirect
        
        // Simulate webhook call to backend
        await fetch('/api/checkout/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'checkout.session.completed',
            data: {
              object: {
                id: data.sessionId,
                customer_details: { email: user.email },
                metadata: { plan: selectedPlan }
              }
            }
          })
        });

        await refreshUser();
        navigate('/dashboard?success=plan_upgraded');
      } else {
        setError(data.error || 'Failed to initiate checkout.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError('Network error during checkout.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 h-16 flex items-center px-6 lg:px-12 sticky top-0 z-30">
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
          <div className="bg-emerald-500 text-slate-950 p-1.5 rounded-xl flex items-center justify-center">
            <Zap size={18} fill="currentColor" />
          </div>
          <span className="font-extrabold text-xl tracking-tight text-slate-900">LeadSprout</span>
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 py-12 lg:py-20">
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          
          {/* Plan Selection Side */}
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-black text-slate-900 mb-2">Upgrade Your Account</h1>
              <p className="text-slate-500 font-medium">Select the best plan for your agency growth.</p>
            </div>

            <div className="space-y-4">
              {Object.entries(plans).map(([key, plan]) => (
                <button
                  key={key}
                  onClick={() => setSelectedPlan(key)}
                  className={`w-full text-left p-6 rounded-2xl border-2 transition-all flex items-center justify-between ${
                    selectedPlan === key 
                      ? 'border-emerald-500 bg-emerald-50/50 shadow-md ring-4 ring-emerald-500/10' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      selectedPlan === key ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                    }`}>
                      {selectedPlan === key && <CheckCircle size={14} className="text-white" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{plan.name}</h3>
                      <p className="text-xs text-slate-500 font-medium">{plan.limit}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-slate-900">{plan.price}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">/ month</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200/50">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Included in every plan:</h4>
              <ul className="space-y-3">
                <li className="flex items-center gap-2.5 text-sm font-semibold text-slate-600">
                  <CheckCircle size={16} className="text-emerald-500" /> Pre-audited Technical SEO Gaps
                </li>
                <li className="flex items-center gap-2.5 text-sm font-semibold text-slate-600">
                  <CheckCircle size={16} className="text-emerald-500" /> Mobile Performance Benchmarks
                </li>
                <li className="flex items-center gap-2.5 text-sm font-semibold text-slate-600">
                  <CheckCircle size={16} className="text-emerald-500" /> Cancel or switch plans anytime
                </li>
              </ul>
            </div>
          </div>

          {/* Checkout Summary Side */}
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl shadow-slate-200/50 space-y-8 sticky top-28">
            <div className="border-b border-slate-100 pb-6">
              <h2 className="text-xl font-black text-slate-900">Order Summary</h2>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-slate-600">
                <span className="font-medium">{plans[selectedPlan].name} (Monthly)</span>
                <span className="font-bold text-slate-900">{plans[selectedPlan].price}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400 text-sm italic">
                <span>Setup Fee</span>
                <span>$0.00</span>
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <span className="text-lg font-bold text-slate-900">Total Due Today</span>
                <span className="text-2xl font-black text-emerald-600">{plans[selectedPlan].price}</span>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-4">
                <div className="bg-slate-200 p-2 rounded-lg text-slate-500">
                  <CreditCard size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Payment Method</p>
                  <p className="text-sm font-bold text-slate-700">LeadSprout Secure Checkout</p>
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 text-rose-500 p-4 rounded-xl text-xs font-bold">
                  {error}
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black py-4 rounded-2xl shadow-lg shadow-slate-900/20 transition-all flex items-center justify-center gap-2"
              >
                {loading ? <Loader className="animate-spin" size={20} /> : (
                  <>Complete Subscription <ArrowRight size={20} /></>
                )}
              </button>

              <div className="flex items-center justify-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Shield size={12} /> SSL Encrypted</span>
                <span className="flex items-center gap-1.5"><Lock size={12} /> Bank-level Security</span>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
