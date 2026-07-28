import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }) {
  const { user } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const closeNavigation = () => { setIsSidebarOpen(false); menuButtonRef.current?.focus(); };
  useEffect(() => {
    if (!isSidebarOpen) return undefined;
    sidebarRef.current?.querySelector('a,button')?.focus();
    const onKey = event => event.key === 'Escape' && closeNavigation();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSidebarOpen]);
  const identity = user?.email || 'Authenticated customer';
  return <div className="saiph-app">
    <a href="#main-content" className="coi-skip-link">Skip to content</a>
    <Sidebar ref={sidebarRef} isOpen={isSidebarOpen} onClose={closeNavigation}/>
    <div className="saiph-stage">
      <header className="saiph-topbar"><button ref={menuButtonRef} className="saiph-menu" aria-label="Open navigation" aria-expanded={isSidebarOpen} aria-controls="primary-navigation" onClick={() => setIsSidebarOpen(true)}><Menu/></button><p className="saiph-shell-title">LeadSprout Commercial Intelligence</p><div className="saiph-identity"><strong>{identity}</strong><span>Authenticated customer</span></div></header>
      <main id="main-content" tabIndex="-1" className="saiph-main">{children}</main>
    </div>
  </div>;
}
