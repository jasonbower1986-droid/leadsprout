import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, CircleHelp, Menu } from 'lucide-react';
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
  const firstName = user?.email?.split(/[.@]/)[0] || 'Jason';
  return <div className="saiph-app">
    <a href="#main-content" className="coi-skip-link">Skip to content</a>
    <Sidebar ref={sidebarRef} isOpen={isSidebarOpen} onClose={closeNavigation}/>
    <div className="saiph-stage">
      <header className="saiph-topbar"><button ref={menuButtonRef} className="saiph-menu" aria-label="Open navigation" aria-expanded={isSidebarOpen} aria-controls="primary-navigation" onClick={() => setIsSidebarOpen(true)}><Menu/></button><h1>Good morning, {firstName.charAt(0).toUpperCase() + firstName.slice(1)}.</h1><div className="saiph-user-tools"><button><CircleHelp size={19}/><span>Help</span></button><button className="saiph-notification"><Bell size={20}/><b>3</b></button><div className="saiph-avatar" aria-hidden="true">JB</div><div className="saiph-identity"><strong>Jason Bower</strong><span>Agency</span></div><ChevronDown size={17}/></div></header>
      <main id="main-content" tabIndex="-1" className="saiph-main">{children}</main>
    </div>
  </div>;
}
