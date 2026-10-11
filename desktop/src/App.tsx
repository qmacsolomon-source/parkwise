import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { isConfigured } from '@parkwise/shared';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import LiveOccupancyDashboard from './pages/LiveOccupancyDashboard';
import PlateVerification from './pages/PlateVerification';
import CashPayment from './pages/CashPayment';
import TimeAndPaymentLog from './pages/TimeAndPaymentLog';
import ManualEntry from './pages/ManualEntry';
import Reports from './pages/Reports';
import AccountCreation from './pages/AccountCreation';
import SlotAssignment from './pages/SlotAssignment';
import UserManagement from './pages/UserManagement';
import RatesAndPricing from './pages/RatesAndPricing';
import Layout from './components/Layout';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Application Error</h1>
            <p className="text-gray-700 mb-4">
              Something went wrong. Please check the console for details.
            </p>
            <details className="text-sm text-gray-600 bg-gray-100 p-4 rounded">
              <summary className="cursor-pointer font-semibold">Error Details</summary>
              <pre className="mt-2 whitespace-pre-wrap">{this.state.error?.message}</pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function EnvCheck({ children }: { children: ReactNode }) {
  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-yellow-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-yellow-600 mb-4">Supabase Not Configured</h1>
          <p className="text-gray-700 mb-4">
            The application requires Supabase environment variables to run.
          </p>
          <div className="bg-gray-100 p-4 rounded text-sm text-gray-700">
            <p className="font-semibold mb-2">Required variables in desktop/.env:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>VITE_SUPABASE_URL (replace placeholder)</li>
              <li>VITE_SUPABASE_ANON_KEY (replace placeholder)</li>
            </ul>
          </div>
          <p className="text-gray-600 mt-4 text-sm">
            Please replace the placeholder values in <code className="bg-gray-100 px-1 rounded">desktop/.env</code> with your actual Supabase credentials and restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Role-based routing
  if (profile?.role === 'customer') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="card max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-primary mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-4">
            Customers should use the mobile app, not this desktop console.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <LiveOccupancyDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/verification"
        element={
          <ProtectedRoute>
            <Layout>
              <PlateVerification />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/payment"
        element={
          <ProtectedRoute>
            <Layout>
              <CashPayment />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/log"
        element={
          <ProtectedRoute>
            <Layout>
              <TimeAndPaymentLog />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/manual-entry"
        element={
          <ProtectedRoute>
            <Layout>
              <ManualEntry />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <Layout>
              <Reports />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/account-creation"
        element={
          <ProtectedRoute>
            <Layout>
              <AccountCreation />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/slot-assignment"
        element={
          <ProtectedRoute>
            <Layout>
              <SlotAssignment />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/user-management"
        element={
          <ProtectedRoute>
            <Layout>
              <UserManagement />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/rates-and-pricing"
        element={
          <ProtectedRoute>
            <Layout>
              <RatesAndPricing />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <EnvCheck>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </EnvCheck>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
