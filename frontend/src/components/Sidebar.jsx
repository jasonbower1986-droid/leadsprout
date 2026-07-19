import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Building2, 
  Settings, LogOut, Zap, X
  , Target
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout, features } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/leads', icon: <Users size={20} />, label: 'Leads' },
    ...(features.opportunity_workspace
      ? [{ to: '/opportunities', icon: <Target size={20} />, label: 'Opportunities' }]
      : []),
    { to: '/agency', icon: <Building2 size={20} />, label: 'My Agency' },
    { to: '/settings', icon: <Settings size={20} />, label: 'Settings' },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/60 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      <aside className={`
        bg-slate-900 text-white w-72 shrink-0 border-r border-slate-800 flex flex-col justify-between h-screen z-50
        fixed inset-y-0 left-0 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div>
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500 p-2 rounded-xl">
                <Zap size={24} className="text-slate-950" fill="currentColor" />
              </div>
              <span className="font-black text-xl tracking-tighter">LeadSprout</span>
            </div>
            <button onClick={onClose} className="lg:hidden p-2 hover:bg-slate-800 rounded-lg text-slate-400">
              <X size={20} />
            </button>
          </div>

          <nav className="mt-6 px-4 space-y-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => {
                  if (window.innerWidth < 1024) onClose();
                }}
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold text-sm transition-all
                  ${isActive 
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                `}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-800/50 rounded-2xl p-4 mb-4">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Account</span>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-slate-950 font-black text-xs">
                {user?.email?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{user?.email}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                    {user?.plan}
                  </span>
                  <span className="text-[9px] font-bold text-slate-500">
                    {user?.plan === 'agency' ? 'Unlimited' : `${user?.unlocks_count} Credits`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-xl font-bold text-sm transition-all"
          >
            <LogOut size={20} />
            Log Out
          </button>
        </div>
      </aside>
    </>
  );
}
