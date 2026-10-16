import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Profile } from '@parkwise/shared';
import {
  Users, AlertTriangle, CheckCircle, LogOut, Bell,
  RefreshCw, Search, Filter, Eye, Edit, Lock,
  Shield, Trash2, X, ChevronLeft, ChevronRight
} from 'lucide-react';

interface ProfileWithDetails extends Profile {
  unpaid_penalty_balance: number;
  last_login: string | null;
  reservation_count: number;
}

export default function UserManagement() {
  const { profile, logout } = useAuth();
  const [profiles, setProfiles] = useState<ProfileWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Search and filter
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'customer' | 'attendant' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Modals
  const [selectedProfile, setSelectedProfile] = useState<ProfileWithDetails | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [showPenaltyModal, setShowPenaltyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  // Form states
  const [editForm, setEditForm] = useState({ full_name: '', email: '', phone: '', role: '' });
  const [penaltyReason, setPenaltyReason] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadProfiles();
  }, [searchQuery, roleFilter, statusFilter]);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (roleFilter !== 'all') {
        query = query.eq('role', roleFilter);
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (searchQuery) {
        query = query.or(`full_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
      }

      const { data } = await query;
      
      // Calculate penalty balance and last login for each profile
      const profilesWithDetails = await Promise.all(
        (data || []).map(async (p: Profile) => {
          // Get unpaid penalties
          const { data: penalties } = await supabase
            .from('penalties')
            .select('amount')
            .eq('customer_id', p.id)
            .eq('status', 'unpaid');
          
          const unpaidBalance = (penalties || []).reduce((sum, pen) => sum + pen.amount, 0);
          
          // Get last login from audit_log
          const { data: lastLogin } = await supabase
            .from('audit_log')
            .select('created_at')
            .eq('actor_id', p.id)
            .eq('action', 'login_success')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          
          // Get reservation count
          const { count } = await supabase
            .from('reservations')
            .select('*', { count: 'exact', head: true })
            .eq('customer_id', p.id);
          
          return {
            ...p,
            unpaid_penalty_balance: unpaidBalance,
            last_login: lastLogin?.created_at || null,
            reservation_count: count || 0,
          };
        })
      );

      setProfiles(profilesWithDetails);
    } catch (error: any) {
      console.error('Error loading profiles:', error);
      setError(error.message || 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedProfile) return;
    
    setActionLoading(true);
    setError('');
    
    try {
      await supabase
        .from('profiles')
        .update({
          full_name: editForm.full_name,
          email: editForm.email,
          phone: editForm.phone,
          role: editForm.role as any,
        })
        .eq('id', selectedProfile.id);

      // Log to audit_log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'profile_updated',
        details: {
          target_user_id: selectedProfile.id,
          changes: editForm,
        },
      });

      setSuccess(true);
      setShowEditModal(false);
      setSelectedProfile(null);
      await loadProfiles();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error updating profile:', error);
      setError(error.message || 'Failed to update profile');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!selectedProfile) return;
    
    setActionLoading(true);
    setError('');
    
    try {
      const newStatus = selectedProfile.status === 'active' ? 'disabled' : 'active';
      
      await supabase
        .from('profiles')
        .update({ status: newStatus })
        .eq('id', selectedProfile.id);

      // Log to audit_log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'user_status_changed',
        details: {
          target_user_id: selectedProfile.id,
          new_status: newStatus,
        },
      });

      setSuccess(true);
      setShowDisableModal(false);
      setSelectedProfile(null);
      await loadProfiles();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error updating status:', error);
      setError(error.message || 'Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedProfile || !newPassword) return;
    
    setActionLoading(true);
    setError('');
    
    try {
      // Reset password via Supabase Auth
      // Note: This requires admin API key in production
      await supabase.auth.admin.updateUserById(selectedProfile.id, {
        password: newPassword,
      });

      // Log to audit_log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'password_reset',
        details: {
          target_user_id: selectedProfile.id,
        },
      });

      setSuccess(true);
      setShowResetPasswordModal(false);
      setSelectedProfile(null);
      setNewPassword('');
      await loadProfiles();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error resetting password:', error);
      setError(error.message || 'Failed to reset password');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePwdToggle = async () => {
    if (!selectedProfile) return;
    
    setActionLoading(true);
    setError('');
    
    try {
      await supabase
        .from('profiles')
        .update({ pwd_verified: !selectedProfile.pwd_verified })
        .eq('id', selectedProfile.id);

      // Log to audit_log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'pwd_verification_changed',
        details: {
          target_user_id: selectedProfile.id,
          new_status: !selectedProfile.pwd_verified,
          permit_number: selectedProfile.pwd_permit_number,
        },
      });

      setSuccess(true);
      setShowPwdModal(false);
      setSelectedProfile(null);
      await loadProfiles();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error updating PWD verification:', error);
      setError(error.message || 'Failed to update PWD verification');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePenaltyWaive = async () => {
    if (!selectedProfile || !penaltyReason) return;
    
    setActionLoading(true);
    setError('');
    
    try {
      // Get unpaid penalties
      const { data: penalties } = await supabase
        .from('penalties')
        .select('*')
        .eq('customer_id', selectedProfile.id)
        .eq('status', 'unpaid');

      // Update penalties
      if (penaltyAmount) {
        // Adjust amount
        const amount = parseFloat(penaltyAmount);
        await supabase
          .from('penalties')
          .update({ amount })
          .eq('customer_id', selectedProfile.id)
          .eq('status', 'unpaid');
      } else {
        // Waive all
        await supabase
          .from('penalties')
          .update({ status: 'paid' })
          .eq('customer_id', selectedProfile.id)
          .eq('status', 'unpaid');
      }

      // Log to audit_log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'penalty_adjusted',
        details: {
          target_user_id: selectedProfile.id,
          reason: penaltyReason,
          new_amount: penaltyAmount || 'waived',
        },
      });

      setSuccess(true);
      setShowPenaltyModal(false);
      setSelectedProfile(null);
      setPenaltyReason('');
      setPenaltyAmount('');
      await loadProfiles();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error adjusting penalty:', error);
      setError(error.message || 'Failed to adjust penalty');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProfile) return;
    
    setActionLoading(true);
    setError('');
    
    try {
      // Check if user has history
      const { count: reservationCount } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', selectedProfile.id);

      if (reservationCount && reservationCount > 0) {
        // Soft delete - disable account
        await supabase
          .from('profiles')
          .update({ status: 'disabled' })
          .eq('id', selectedProfile.id);

        // Log as soft delete
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('audit_log').insert({
          actor_id: user?.id,
          action: 'user_soft_deleted',
          details: {
            target_user_id: selectedProfile.id,
            reason: 'User has reservation history',
          },
        });
      } else {
        // Hard delete
        await supabase.auth.admin.deleteUser(selectedProfile.id);
        await supabase.from('profiles').delete().eq('id', selectedProfile.id);

        // Log as hard delete
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('audit_log').insert({
          actor_id: user?.id,
          action: 'user_deleted',
          details: {
            target_user_id: selectedProfile.id,
          },
        });
      }

      setSuccess(true);
      setShowDeleteModal(false);
      setSelectedProfile(null);
      await loadProfiles();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error deleting user:', error);
      setError(error.message || 'Failed to delete user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  // Pagination
  const totalPages = Math.ceil(profiles.length / itemsPerPage);
  const paginatedProfiles = profiles.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="card max-w-md w-full mx-4 text-center">
          <Shield className="text-red-600 mx-auto mb-4" size={48} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">This page is only accessible to administrators.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">User Management</h1>
              <p className="text-sm text-gray-600">Manage Staff & Customers</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg ${soundEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}
            >
              <Bell size={18} />
            </button>
            <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
              {profile?.role}
            </span>
            <button
              onClick={() => setShowLogoutModal(true)}
              className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {success && (
          <div className="mb-4 p-4 bg-green-50 text-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={20} />
            <span className="font-semibold">Operation successful!</span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 text-red-800 rounded-lg flex items-center gap-2">
            <AlertTriangle size={20} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Filters */}
        <div className="card mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search size={18} className="text-gray-500" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-gray-500" />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Roles</option>
                <option value="customer">Customers</option>
                <option value="attendant">Attendants</option>
                <option value="admin">Admins</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <button
              onClick={loadProfiles}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Role</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">PWD</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Penalty Balance</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Reservations</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Last Login</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-gray-500">Loading...</td>
                  </tr>
                ) : paginatedProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-gray-500">No users found</td>
                  </tr>
                ) : (
                  paginatedProfiles.map((user) => (
                    <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{user.full_name}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{user.email}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                          user.role === 'attendant' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {user.pwd_permit_number ? (
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            user.pwd_verified ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {user.pwd_verified ? 'Verified' : 'Pending'}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">
                        ₱{user.unpaid_penalty_balance.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{user.reservation_count}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedProfile(user);
                              setShowDetailsModal(true);
                            }}
                            className="p-1 text-gray-500 hover:text-primary"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedProfile(user);
                              setEditForm({ full_name: user.full_name, email: user.email, phone: user.phone, role: user.role });
                              setShowEditModal(true);
                            }}
                            className="p-1 text-gray-500 hover:text-primary"
                            title="Edit"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedProfile(user);
                              setShowDisableModal(true);
                            }}
                            className="p-1 text-gray-500 hover:text-primary"
                            title="Disable/Enable"
                          >
                            <Lock size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedProfile(user);
                              setShowResetPasswordModal(true);
                            }}
                            className="p-1 text-gray-500 hover:text-primary"
                            title="Reset Password"
                          >
                            <Shield size={16} />
                          </button>
                          {user.pwd_permit_number && (
                            <button
                              onClick={() => {
                                setSelectedProfile(user);
                                setShowPwdModal(true);
                              }}
                              className="p-1 text-gray-500 hover:text-primary"
                              title="Verify PWD"
                            >
                              <Shield size={16} />
                            </button>
                          )}
                          {user.unpaid_penalty_balance > 0 && (
                            <button
                              onClick={() => {
                                setSelectedProfile(user);
                                setShowPenaltyModal(true);
                              }}
                              className="p-1 text-gray-500 hover:text-primary"
                              title="Waive/Adjust Penalty"
                            >
                              <Shield size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectedProfile(user);
                              setShowDeleteModal(true);
                            }}
                            className="p-1 text-gray-500 hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, profiles.length)} of {profiles.length} users
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 text-gray-500 hover:text-primary disabled:opacity-50"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 text-gray-500 hover:text-primary disabled:opacity-50"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {showDetailsModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">User Details</h3>
              <button onClick={() => setShowDetailsModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Full Name</label>
                <p className="text-gray-900">{selectedProfile.full_name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Email</label>
                <p className="text-gray-900">{selectedProfile.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Phone</label>
                <p className="text-gray-900">{selectedProfile.phone || '-'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Role</label>
                <p className="text-gray-900 capitalize">{selectedProfile.role}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Status</label>
                <p className="text-gray-900 capitalize">{selectedProfile.status}</p>
              </div>
              {selectedProfile.pwd_permit_number && (
                <>
                  <div>
                    <label className="text-sm font-medium text-gray-700">PWD Permit Number</label>
                    <p className="text-gray-900">{selectedProfile.pwd_permit_number}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">PWD Verified</label>
                    <p className="text-gray-900">{selectedProfile.pwd_verified ? 'Yes' : 'No'}</p>
                  </div>
                </>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700">Unpaid Penalty Balance</label>
                <p className="text-gray-900 font-medium">₱{selectedProfile.unpaid_penalty_balance.toFixed(2)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Total Reservations</label>
                <p className="text-gray-900">{selectedProfile.reservation_count}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Last Login</label>
                <p className="text-gray-900">{selectedProfile.last_login ? new Date(selectedProfile.last_login).toLocaleString() : 'Never'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Created At</label>
                <p className="text-gray-900">{new Date(selectedProfile.created_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Edit User</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="input"
                >
                  <option value="customer">Customer</option>
                  <option value="attendant">Attendant</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowEditModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleEdit} disabled={actionLoading} className="btn-primary flex-1">
                {actionLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disable/Enable Modal */}
      {showDisableModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {selectedProfile.status === 'active' ? 'Disable User' : 'Enable User'}
            </h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to {selectedProfile.status === 'active' ? 'disable' : 'enable'} {selectedProfile.full_name}?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDisableModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleDisable} disabled={actionLoading} className="btn-primary flex-1">
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetPasswordModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Reset Password</h3>
              <button onClick={() => setShowResetPasswordModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-gray-600">Reset password for {selectedProfile.full_name}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input"
                  placeholder="Enter new password"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowResetPasswordModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleResetPassword} disabled={actionLoading || !newPassword} className="btn-primary flex-1">
                {actionLoading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PWD Verification Modal */}
      {showPwdModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">PWD Permit Verification</h3>
              <button onClick={() => setShowPwdModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Permit Number</label>
                <p className="text-gray-900 font-medium">{selectedProfile.pwd_permit_number}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Current Status</label>
                <p className="text-gray-900">{selectedProfile.pwd_verified ? 'Verified' : 'Pending'}</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPwdModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handlePwdToggle} disabled={actionLoading} className="btn-primary flex-1">
                {actionLoading ? 'Updating...' : (selectedProfile.pwd_verified ? 'Mark Unverified' : 'Mark Verified')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Penalty Waive/Adjust Modal */}
      {showPenaltyModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Waive/Adjust Penalty</h3>
              <button onClick={() => setShowPenaltyModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Current Balance</label>
                <p className="text-gray-900 font-medium">₱{selectedProfile.unpaid_penalty_balance.toFixed(2)}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Amount (leave blank to waive all)</label>
                <input
                  type="number"
                  value={penaltyAmount}
                  onChange={(e) => setPenaltyAmount(e.target.value)}
                  className="input"
                  placeholder="Enter new amount or leave blank to waive"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
                <textarea
                  value={penaltyReason}
                  onChange={(e) => setPenaltyReason(e.target.value)}
                  className="input"
                  rows={3}
                  placeholder="Enter reason for waiver/adjustment"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPenaltyModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handlePenaltyWaive} disabled={actionLoading || !penaltyReason} className="btn-primary flex-1">
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="text-red-600" size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Delete User</h3>
              <p className="text-gray-600">
                Are you sure you want to delete {selectedProfile.full_name}?
                {selectedProfile.reservation_count > 0 && (
                  <span className="block mt-2 text-sm text-amber-600">
                    This user has reservation history and will be soft-disabled instead.
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleDelete} disabled={actionLoading} className="btn-primary flex-1 bg-red-600 hover:bg-red-700">
                {actionLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="text-amber-600" size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Confirm Logout</h3>
              <p className="text-gray-600">
                Are you sure you want to log out?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoutModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleLogout} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <LogOut size={18} />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
