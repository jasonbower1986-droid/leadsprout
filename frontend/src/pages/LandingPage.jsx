import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, Zap, Search, Mail, CheckCircle, Smartphone, ArrowRight, Menu, X, ArrowUpRight } from 'lucide-react';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sampleLead, setSampleLead] = useState(null);
  const [sampleLoading, setSampleLoading] = useState(true);

  // Fetch a sample lead from the DB to show as an interactive demo
  useEffect(() => {
    async function fetchSample() {
      try {
        const res = await fetch('/api/leads');
        if (res.ok) {
          const data = await res.json();
          // Find a highly illustrative lead with various gaps to show off
          const representative = data.find(l => l.responsive_status === 'not_responsive' && l.speed_score < 50) || data[0];
          setSampleLead(representative);
        }
      } catch (err) {
        console.error('Failed to load sample lead:', err);
      } finally {
        setSampleLoading(false);
      }
    }
    fetchSample();
  }, []);

  const pricingPlans = [
    {
      name: "Basic Plan",
      price: "$29",
      period: "/month",
      desc: "Perfect for solo freelancers starting out.",
      features: [
        "50 curated leads per month",
        "Basic Website Audits (Mobile & Speed)",
        "Standard Outreach Pitch Templates",
        "E-mail Support"
      ],
      cta: "Get Basic",
      popular: false
    },
    {
      name: "Pro Plan",
      price: "$79",
      period: "/month",
      desc: "Our most popular plan for active agencies.",
      features: [
        "250 curated leads per month",
        "Deep SEO & Performance Gaps Audit",
        "Verified Contact Emails",
        "AI-Generated Personalized Pitch Templates",
        "Priority Email Support"
      ],
      cta: "Get Pro",
      popular: true
    },
    {
      name: "Agency Plan",
      price: "$149",
      period: "/month",
      desc: "For outreach teams ready to scale rapidly.",
      features: [
        "Unlimited Curated Leads",
        "Automated Email Sequence Generation",
        "CRM Integrations (HubSpot, Salesforce)",
        "Dedicated Account Success Manager",
        "24/7 Priority SLA Support"
      ],
      cta: "Get Agency",
      popular: false
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500 text-white p-2 rounded-xl flex items-center justify-center">
                <Zap size={22} fill="currentColor" />
              </div>
              <span className="font-extrabold text-2xl tracking-tight text-slate-900 bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                LeadSprout
              </span>
            </div>
            
            <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
              <a href="#features" className="hover:text-emerald-600 transition-colors">How It Works</a>
              <a href="#demo" className="hover:text-emerald-600 transition-colors">Interactive Demo</a>
              <a href="#pricing" className="hover:text-emerald-600 transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-emerald-600 transition-colors">FAQ</a>
            </nav>

            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <button
                  onClick={() => navigate('/dashboard')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-1.5"
                >
                  Go to Dashboard <ArrowRight size={16} />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => navigate('/login')}
                    className="text-slate-700 hover:text-slate-900 font-semibold text-sm transition-all px-4 py-2"
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => navigate('/register')}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-all"
                  >
                    Sign Up
                  </button>
                </>
              )}
            </div>

            <button 
              className="md:hidden text-slate-700 p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 py-4 px-4 space-y-4 shadow-inner">
            <a 
              href="#features" 
              onClick={() => setMobileMenuOpen(false)}
              className="block font-semibold text-slate-600 hover:text-emerald-600"
            >
              How It Works
            </a>
            <a 
              href="#demo" 
              onClick={() => setMobileMenuOpen(false)}
              className="block font-semibold text-slate-600 hover:text-emerald-600"
            >
              Interactive Demo
            </a>
            <a 
              href="#pricing" 
              onClick={() => setMobileMenuOpen(false)}
              className="block font-semibold text-slate-600 hover:text-emerald-600"
            >
              Pricing
            </a>
            <a 
              href="#faq" 
              onClick={() => setMobileMenuOpen(false)}
              className="block font-semibold text-slate-600 hover:text-emerald-600"
            >
              FAQ
            </a>
            <div className="pt-2 border-t border-slate-100 flex flex-col gap-3">
              {user ? (
                <button
                  onClick={() => navigate('/dashboard')}
                  className="w-full bg-emerald-600 text-white text-center py-2.5 rounded-xl font-semibold shadow-sm"
                >
                  Go to Dashboard
                </button>
              ) : (
                <>
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full text-slate-700 border border-slate-200 text-center py-2.5 rounded-xl font-semibold"
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => navigate('/register')}
                    className="w-full bg-slate-900 text-white text-center py-2.5 rounded-xl font-semibold"
                  >
                    Sign Up
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 lg:py-32 bg-gradient-to-b from-white via-slate-50 to-slate-50">
        <div className="absolute top-0 right-0 -z-10 w-1/3 h-2/3 bg-emerald-100/30 rounded-bl-full blur-3xl" />
        <div className="absolute bottom-10 left-10 -z-10 w-72 h-72 bg-teal-100/20 rounded-full blur-2xl" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-4 py-1.5 rounded-full text-emerald-700 font-semibold text-sm mb-6 animate-pulse">
            <Shield size={16} /> Rated 4.9/5 by Freelancers & Agencies
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight max-w-4xl mx-auto">
            Stop Hunting for Clients.<br />
            Receive <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">Hyper-Qualified</span> Warm Leads Daily.
          </h1>
          
          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            LeadSprout automatically audits local business websites for technical SEO gaps, speed bottlenecks, and mobile rendering errors—delivering actionable lead profiles with verified emails and ready-made pitch copy.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate('/register')}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base px-8 py-4 rounded-xl shadow-lg hover:shadow-emerald-600/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Get Started for Free <ArrowRight size={18} />
            </button>
            <a
              href="#demo"
              className="w-full sm:w-auto bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 font-bold text-base px-8 py-4 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
            >
              See a Sample Lead <ArrowUpRight size={18} />
            </a>
          </div>

          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500 font-medium">
            <span className="flex items-center gap-1.5"><CheckCircle size={16} className="text-emerald-500" /> No Credit Card Required</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={16} className="text-emerald-500" /> 20+ Seeded Demo Leads</span>
          </div>
        </div>
      </section>

      {/* Feature Gaps / How It Works */}
      <section id="features" className="py-20 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
              Turn Site Audits Into High-Converting Sales Opportunities
            </h2>
            <p className="mt-4 text-lg text-slate-600">
              Businesses don't respond to general cold pitches. They respond when you point out exact, actionable technical issues with their website.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="w-12 h-12 bg-rose-500/10 text-rose-600 rounded-2xl flex items-center justify-center mb-6">
                <Zap size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Sluggish Page Speeds</h3>
              <p className="text-slate-600 leading-relaxed">
                We identify local business sites scoring in the red zones. Pitch performance-first web designs to recapture their abandoned mobile visitors.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="w-12 h-12 bg-amber-500/10 text-amber-600 rounded-2xl flex items-center justify-center mb-6">
                <Smartphone size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Non-Responsive Layouts</h3>
              <p className="text-slate-600 leading-relaxed">
                60%+ of clients search on smartphones. We flag companies whose checkout and navigation are completely broken on mobile viewports.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="w-12 h-12 bg-indigo-500/10 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
                <Search size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">SEO Technical Glitches</h3>
              <p className="text-slate-600 leading-relaxed">
                Instantly capture missing meta tags, broken headers, and invalid SSL certificates. Deliver custom, pre-drafted SEO fixes they can immediately approve.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Demo Block */}
      <section id="demo" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-emerald-600 font-extrabold text-sm uppercase tracking-wider">Live Platform Demo</span>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl mt-2">
              See the LeadSprout Edge in Action
            </h2>
            <p className="mt-4 text-lg text-slate-600">
              This is a live lead profile taken straight from our curated database. Click register to access another 25 highly qualified targets!
            </p>
          </div>

          {sampleLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sampleLead ? (
            <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl flex flex-col md:flex-row">
              {/* Left Column: Lead Audit Details */}
              <div className="p-8 md:w-3/5 border-b md:border-b-0 md:border-r border-slate-100">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <span className="bg-emerald-50 text-emerald-700 text-xs font-bold uppercase px-3 py-1 rounded-full border border-emerald-100">
                      {sampleLead.niche}
                    </span>
                    <h3 className="text-2xl font-extrabold text-slate-900 mt-2">{sampleLead.business_name}</h3>
                    <p className="text-sm text-slate-500 font-medium">{sampleLead.location} • <a href={`https://${sampleLead.domain}`} target="_blank" rel="noreferrer" className="text-emerald-600 font-semibold hover:underline">{sampleLead.domain}</a></p>
                  </div>
                  
                  {/* Speed Score Circle */}
                  <div className="flex flex-col items-center">
                    <div className={`w-14 h-14 rounded-full border-4 flex items-center justify-center font-black text-lg ${
                      sampleLead.speed_score >= 80 ? 'border-emerald-500 text-emerald-600 bg-emerald-50' :
                      sampleLead.speed_score >= 50 ? 'border-amber-500 text-amber-600 bg-amber-50' :
                      'border-rose-500 text-rose-600 bg-rose-50'
                    }`}>
                      {sampleLead.speed_score}
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Speed Score</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Scraped Gap Gaps Found:</span>
                    <div className="mt-2 space-y-2">
                      {sampleLead.seo_gaps.map((gap, index) => (
                        <div key={index} className="flex items-center gap-2.5 text-slate-700 text-sm font-medium">
                          <div className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
                          <span>{gap}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Responsive Viewport:</span>
                      <p className={`text-sm font-extrabold mt-1 uppercase ${sampleLead.responsive_status === 'responsive' ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {sampleLead.responsive_status === 'responsive' ? 'Responsive' : 'Non-Responsive Layout'}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Decision-Maker Contact:</span>
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 mt-1 bg-slate-100 px-3 py-1 rounded-xl">
                        <Mail size={14} className="text-slate-400" />
                        {sampleLead.verified_emails[0]} (Locked Sample)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Dynamic Selling Blueprint CTA */}
              <div className="p-8 md:w-2/5 bg-slate-900 text-white flex flex-col justify-between">
                <div>
                  <h4 className="text-lg font-bold text-emerald-400">Ready to Pitch?</h4>
                  <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                    LeadSprout automatically loads customized template outreach. We map the detected gaps—such as {sampleLead.seo_gaps[0] || 'outdated layout'}—directly into a personal, high-converting sequence.
                  </p>
                </div>

                <div className="mt-8 bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-xs font-mono text-emerald-300">
                  <p className="text-slate-400 border-b border-slate-700 pb-2 mb-2 font-sans font-bold uppercase tracking-wider">Personalized Email Preview</p>
                  <p className="font-semibold text-white truncate"><span className="text-slate-400 font-normal font-sans">Subject:</span> Quick note regarding {sampleLead.domain}</p>
                  <p className="mt-2 text-slate-300 leading-relaxed text-[11px]">
                    "Hi there, I noticed {sampleLead.business_name}'s website is missing key technical elements like {sampleLead.seo_gaps[0]}..."
                  </p>
                </div>

                <button
                  onClick={() => navigate('/register')}
                  className="mt-6 w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold text-sm py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5"
                >
                  Create Free Account <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <p className="text-center text-slate-500">No demo data available. Run the database seed script.</p>
          )}
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
              Plans Designed to Scale Your Agency
            </h2>
            <p className="mt-4 text-lg text-slate-600">
              Start finding hyper-qualified warm leads today. Choose the plan that fits your current outreach targets.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch max-w-6xl mx-auto">
            {pricingPlans.map((plan, index) => (
              <div 
                key={index} 
                className={`border rounded-3xl p-8 flex flex-col justify-between shadow-sm relative transition-all ${
                  plan.popular 
                    ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-slate-900 text-white md:scale-[1.03] z-10' 
                    : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 text-xs font-black uppercase tracking-wider px-4.5 py-1.5 rounded-full">
                    Most Popular
                  </span>
                )}
                
                <div>
                  <h3 className={`text-xl font-bold ${plan.popular ? 'text-emerald-400' : 'text-slate-900'}`}>{plan.name}</h3>
                  <p className={`text-sm mt-2 ${plan.popular ? 'text-slate-400' : 'text-slate-500'}`}>{plan.desc}</p>
                  
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                    <span className={`text-sm font-semibold ${plan.popular ? 'text-slate-400' : 'text-slate-500'}`}>{plan.period}</span>
                  </div>

                  <ul className="mt-8 space-y-3.5">
                    {plan.features.map((feature, fIndex) => (
                      <li key={fIndex} className="flex items-start gap-2.5 text-sm font-medium">
                        <CheckCircle size={16} className={`shrink-0 mt-0.5 ${plan.popular ? 'text-emerald-400' : 'text-emerald-600'}`} />
                        <span className={plan.popular ? 'text-slate-300' : 'text-slate-700'}>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => navigate('/register')}
                  className={`mt-10 w-full py-3.5 rounded-xl font-bold text-sm shadow-md transition-all ${
                    plan.popular
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">How does LeadSprout find leads?</h4>
              <p className="mt-2 text-slate-600 text-sm leading-relaxed">
                Our proprietary scraper regularly processes new registries, listings, and directories. We perform real-time, non-invasive checks for technical criteria (like SSL, page size/complexity, titles, headers, and responsive HTML viewports) to detect which sites are lagging.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">What qualifies as a "warm lead"?</h4>
              <p className="mt-2 text-slate-600 text-sm leading-relaxed">
                These are active, registered businesses that have severe, visible flaws in their online presence. Pointing out concrete technical problems gives you a major advantage over generic "Do you want web design?" cold pitches.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900">Are the emails actually verified?</h4>
              <p className="mt-2 text-slate-600 text-sm leading-relaxed">
                Yes. Pro and Agency plans fetch direct decision-maker contact emails (Founders, CEOs, Owners, or Info addresses) which are validated to confirm your sales outreach actually hits a real inbox.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6 text-sm">
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-500 text-slate-950 p-1.5 rounded-lg">
              <Zap size={16} fill="currentColor" />
            </div>
            <span className="font-bold text-lg text-white">LeadSprout</span>
          </div>
          <p>© 2026 LeadSprout. Built with React, Vite & Tailwind CSS. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
