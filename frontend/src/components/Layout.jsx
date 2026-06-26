import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { Menu, Zap } from 'lucide-react';

export default function Layout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex bg-slate-50 min-h-screen overflow-hidden font-sans">
      {/* Sidebar Component handles its own responsive visibility */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      {/* Main Content Area */}
      <main className="flex-1 h-screen overflow-y-auto flex flex-col min-w-0 relative">
        {/* Mobile Global Header */}
        <header className="lg:hidden bg-slate-900 text-white h-16 flex items-center justify-between px-6 shrink-0 z-30 shadow-md">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-emerald-500" fill="currentColor" />
            <span className="font-black text-lg tracking-tighter">LeadSprout</span>
          </div>
          <button 
            id="mobile-menu-button"
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
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
