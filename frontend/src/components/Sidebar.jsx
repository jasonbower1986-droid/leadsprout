import { forwardRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, FileText, Grid2X2, Search, Settings, X } from 'lucide-react';
import saiphLabLogo from '../assets/brand/SaiphLab_Logo_Production_Master_Phase2A_Dark.svg';

const platform = [
  { to: '/opportunities', label: 'Opportunities', icon: Search },
  { to: '/workspace', label: 'Workspace', icon: Grid2X2 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/activity', label: 'Activity Feed', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const Sidebar = forwardRef(function Sidebar({ isOpen, onClose }, ref) {
  const location = useLocation();
  const navItems = platform.map(item => ({
    ...item,
    active: (item.to === '/opportunities' && location.pathname.startsWith('/opportunities'))
      || (item.to !== '/opportunities' && location.pathname === item.to),
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
      </div>
    </aside>
  </>;
});
export default Sidebar;
