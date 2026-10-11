import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  ShieldCheck,
  DollarSign,
  FileText,
  UserPlus,
  MapPin,
  Clock,
  CreditCard,
  LogOut,
  ChevronRight,
  X
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  adminOnly: boolean;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);

  const isAdmin = profile?.role === 'admin';

  const navItems: NavItem[] = [
    { path: '/', label: 'Live Occupancy', icon: LayoutDashboard, adminOnly: false },
    { path: '/verification', label: 'Plate Verification', icon: ShieldCheck, adminOnly: false },
    { path: '/payment', label: 'Cash Payment', icon: CreditCard, adminOnly: false },
    { path: '/log', label: 'Time & Payment Log', icon: FileText, adminOnly: false },
    { path: '/manual-entry', label: 'Manual Entry', icon: Clock, adminOnly: false },
    { path: '/slot-assignment', label: 'Slot Assignment', icon: MapPin, adminOnly: false },
    { path: '/reports', label: 'Reports', icon: FileText, adminOnly: true },
    { path: '/account-creation', label: 'Account Creation', icon: UserPlus, adminOnly: true },
    { path: '/user-management', label: 'User Management', icon: FileText, adminOnly: true },
    { path: '/rates-and-pricing', label: 'Rates & Pricing', icon: DollarSign, adminOnly: true },
  ];

  const filteredNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  const handleLogout = () => {
    logout();
    navigate('/login');
    setShowLogoutModal(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(path);
      onClose();
    }
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full bg-[#0F2A4A] text-white z-50 transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:static lg:z-0 w-64`}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-[#1e3a5f]">
            <h1 className="text-2xl font-bold text-[#14B8A6]">ParkWise</h1>
            <p className="text-sm text-gray-400 mt-1">Attendant Console</p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4" aria-label="Main">
            <ul className="space-y-1" role="menu">
              {filteredNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;

                return (
                  <li key={item.path} role="none">
                    <button
                      onClick={() => {
                        navigate(item.path);
                        onClose();
                      }}
                      onKeyDown={(e) => handleKeyDown(e, item.path)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
                        isActive
                          ? 'bg-[#14B8A6] text-white'
                          : 'text-gray-300 hover:bg-[#1e3a5f] hover:text-white'
                      }`}
                      role="menuitem"
                      aria-current={isActive ? 'page' : undefined}
                      tabIndex={0}
                    >
                      <Icon size={20} aria-hidden="true" />
                      <span className="font-medium">{item.label}</span>
                      {isActive && <ChevronRight size={16} className="ml-auto" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Footer - Logout */}
          <div className="p-4 border-t border-[#1e3a5f]">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-red-600 hover:text-white transition-colors duration-200"
              aria-label="Logout"
            >
              <LogOut size={20} aria-hidden="true" />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 id="logout-title" className="text-xl font-bold text-gray-900 mb-4">
              Confirm Logout
            </h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to logout? You will need to sign in again to access the console.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
