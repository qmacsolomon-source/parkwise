import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import { Menu, Bell } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile } = useAuth();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 lg:px-6 lg:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Open menu"
              >
                <Menu size={24} />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Welcome, {profile?.full_name || 'User'}
                </h2>
                <p className="text-sm text-gray-500 capitalize">
                  {profile?.role || 'Loading...'}
                </p>
              </div>
            </div>

            <button
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative"
              aria-label="Notifications"
            >
              <Bell size={24} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
