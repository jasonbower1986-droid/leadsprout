import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

// Public Views
import LandingPage from './pages/LandingPage';
import AuditDemo from './pages/AuditDemo';
import Login from './pages/Login';
import Register from './pages/Register';
import Checkout from './pages/Checkout';

// Protected Views
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Agency from './pages/Agency';
import Settings from './pages/Settings';
import Opportunities from './pages/Opportunities';
import OpportunityDetail from './pages/OpportunityDetail';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Layout>{children}</Layout>;
};

const OpportunityWorkspaceRoute = ({ children }) => {
  const { features, loading } = useAuth();
  if (loading) return null;
  return features.opportunity_workspace
    ? <ProtectedRoute>{children}</ProtectedRoute>
    : <Navigate to="/dashboard" replace />;
};

const PublicOnlyRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/demo/:leadId" element={<AuditDemo />} />
          <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
          <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
          <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/leads" element={<ProtectedRoute><Leads /></ProtectedRoute>} />
          <Route path="/agency" element={<ProtectedRoute><Agency /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/opportunities" element={<OpportunityWorkspaceRoute><Opportunities /></OpportunityWorkspaceRoute>} />
          <Route path="/opportunities/:workspaceId" element={<OpportunityWorkspaceRoute><OpportunityDetail /></OpportunityWorkspaceRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
