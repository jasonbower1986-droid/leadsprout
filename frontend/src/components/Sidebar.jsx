import { forwardRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, FileText, Grid2X2, Home, Leaf, Search, Settings, X } from 'lucide-react';
import saiphLabLogo from '../assets/brand/SaiphLab_Logo_Production_Master_Phase2A.svg';

const platform = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/opportunities', label: 'Opportunities', icon: Search },
  { to: '/agency', label: 'Workspace', icon: Grid2X2 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/activity', label: 'Activity Feed', icon: Activity },
];
const products = [
  ['LeadSprout', 'green'], ['ProposalSprout', 'purple'],
  ['AuditSprout', 'orange'], ['ClientSprout', 'cyan'],
];

const Sidebar = forwardRef(function Sidebar({ isOpen, onClose }, ref) {
  const location = useLocation();
  const navItems = platform.map(item => ({
    ...item,
    active: (item.to === '/dashboard' && location.pathname === '/dashboard')
      || (item.to === '/opportunities' && (location.pathname === '/opportunities' || location.pathname.startsWith('/opportunities/')))
      || (item.to !== '/dashboard' && item.to !== '/opportunities' && location.pathname === item.to),
  }));
  return <>
    {isOpen && <button className="saiph-nav-overlay" aria-label="Close navigation" onClick={onClose}/>}
    <aside id="primary-navigation" ref={ref} aria-label="Primary navigation" className={`saiph-sidebar ${isOpen ? 'is-open' : ''}`}>
      <div>
        <div className="saiph-brand"><img src={saiphLabLogo} alt="SaiphLab"/><button onClick={onClose} aria-label="Close navigation" className="saiph-nav-close"><X size={19}/></button></div>
        <p className="saiph-nav-label">Platform</p>
        <nav>{navItems.map(item => {
          const Icon = item.icon;
          return <Link key={item.label} to={item.to} onClick={onClose} aria-current={item.active ? 'page' : undefined} className={`saiph-nav-link ${item.active ? 'active' : ''}`}><Icon size={18}/><span>{item.label}</span></Link>;
        })}</nav>
        <div className="saiph-nav-rule"/><p className="saiph-nav-label">Products</p>
        <div className="saiph-products">{products.map(([label,color]) => <div className="saiph-product" key={label}><Leaf size={18} className={color}/><span>{label}</span></div>)}</div>
        <div className="saiph-nav-rule"/><p className="saiph-nav-label">Settings</p>
        <Link to="/settings" onClick={onClose} className="saiph-nav-link"><Settings size={18}/><span>Settings</span></Link>
      </div>
      <section className="saiph-plan" aria-label="Professional plan usage">
        <div className="saiph-plan-title"><span>Professional plan</span><b>Current</b></div><small>Analyses used</small>
        <div className="saiph-usage"><div className="saiph-ring"/><strong>347</strong><span>/ 500<br/>analyses used</span></div>
        <p>69% of monthly quota</p><p>Resets in 16 days</p><a href="#manage">Manage subscription →</a>
      </section>
    </aside>
  </>;
});
export default Sidebar;
