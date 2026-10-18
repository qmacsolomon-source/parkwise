import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import { Menu, Bell } from 'lucide-react';
import { supabase, Notification } from '@parkwise/shared';

interface LayoutProps {
  children: React.ReactNode;
}

function formatRelativeTime(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  return `${diffWeek}w ago`;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const loadNotifications = useCallback(async () => {
    if (!profile?.id) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }
    setNotificationsLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setNotifications((data as Notification[]) || []);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (notification: Notification) => {
    if (notification.is_read) return;

    // Optimistic update
    setNotifications(prev =>
      prev.map(n => (n.id === notification.id ? { ...n, is_read: true } : n))
    );

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification.id);

      if (error) throw error;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      // Revert optimistic update on failure
      setNotifications(prev =>
        prev.map(n => (n.id === notification.id ? { ...n, is_read: false } : n))
      );
    }
  };

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

            <div className="relative" ref={notificationsRef}>
              <button
                onClick={() => setShowNotifications(prev => !prev)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative"
                aria-label="Notifications"
                aria-expanded={showNotifications}
              >
                <Bell size={24} />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 rounded-full text-[10px] font-semibold text-white leading-none"
                    aria-hidden="true"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div
                  className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-hidden flex flex-col"
                  role="dialog"
                  aria-label="Notifications"
                >
                  <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                    {unreadCount > 0 && (
                      <span className="text-xs text-gray-500">{unreadCount} unread</span>
                    )}
                  </div>

                  <div className="overflow-y-auto flex-1">
                    {notificationsLoading ? (
                      <p className="px-4 py-6 text-sm text-gray-500 text-center">Loading...</p>
                    ) : notifications.length === 0 ? (
                      <p className="px-4 py-6 text-sm text-gray-500 text-center">No notifications yet</p>
                    ) : (
                      <ul role="list">
                        {notifications.map((notification) => (
                          <li key={notification.id}>
                            <button
                              onClick={() => handleMarkAsRead(notification)}
                              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors flex gap-2 items-start ${
                                notification.is_read ? '' : 'bg-teal-50'
                              }`}
                            >
                              <span
                                className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                                  notification.is_read ? 'bg-transparent' : 'bg-[#14B8A6]'
                                }`}
                                aria-hidden="true"
                              />
                              <span className="flex-1 min-w-0">
                                <span
                                  className={`block text-sm ${
                                    notification.is_read ? 'font-normal text-gray-700' : 'font-semibold text-gray-900'
                                  }`}
                                >
                                  {notification.title}
                                </span>
                                <span className="block text-xs text-gray-500 mt-0.5">
                                  {notification.body}
                                </span>
                                <span className="block text-xs text-gray-400 mt-1">
                                  {formatRelativeTime(notification.created_at)}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
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
