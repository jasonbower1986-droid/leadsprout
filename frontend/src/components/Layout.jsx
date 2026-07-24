import { useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import { Menu, Zap } from 'lucide-react';

export default function Layout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarRef = useRef(null); const menuButtonRef = useRef(null);
  const closeNavigation = () => { setIsSidebarOpen(false); menuButtonRef.current?.focus(); };
  useEffect(() => {
    if (!isSidebarOpen) return undefined;
    const focusable = sidebarRef.current?.querySelector('a,button'); focusable?.focus();
    const onKey = event => { if (event.key === 'Escape') closeNavigation(); };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [isSidebarOpen]);

  return (
    <div className="flex bg-slate-50 min-h-screen overflow-hidden font-sans">
      {/* Sidebar Component handles its own responsive visibility */}
      <a href="#main-content" className="coi-skip-link">Skip to content</a>
      <Sidebar ref={sidebarRef} isOpen={isSidebarOpen} onClose={closeNavigation} />
      
      {/* Main Content Area */}
      <main id="main-content" tabIndex="-1" className="flex-1 h-screen overflow-y-auto flex flex-col min-w-0 relative">
        {/* Mobile Global Header */}
        <header className="lg:hidden bg-slate-900 text-white h-16 flex items-center justify-between px-6 shrink-0 z-30 shadow-md">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-emerald-500" fill="currentColor" />
            <span className="font-black text-lg tracking-tighter">LeadSprout</span>
          </div>
          <button ref={menuButtonRef}
            id="mobile-menu-button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open navigation" aria-expanded={isSidebarOpen} aria-controls="primary-navigation"
            className="p-3 min-w-11 min-h-11 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Menu size={24} />
          </button>
        </header>

        {/* Page Content */}
        <div className="p-4 md:p-8 lg:p-10 max-w-[1600px] mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
