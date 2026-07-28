import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

// Public Views
import LandingPage from './pages/LandingPage';
import AuditDemo from './pages/AuditDemo';
import Login from './pages/Login';
import Register from './pages/Register';
import Checkout from './pages/Checkout';

// Protected Views
import Settings from './pages/Settings';
import Opportunities from './pages/Opportunities';
import OpportunityDetail from './pages/OpportunityDetail';
import OpportunityWorkspace from './pages/OpportunityWorkspace';
import Reports from './pages/Reports';
import ReportDetail from './pages/ReportDetail';
import ActivityFeed from './pages/ActivityFeed';

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
    : <Navigate to="/settings" replace />;
};

const PublicOnlyRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) {
    return <Navigate to="/opportunities" replace />;
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
          <Route path="/dashboard" element={<Navigate to="/opportunities" replace />} />
          <Route path="/leads" element={<Navigate to="/opportunities" replace />} />
          <Route path="/agency" element={<Navigate to="/workspace" replace />} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/workspace" element={<OpportunityWorkspaceRoute><OpportunityWorkspace /></OpportunityWorkspaceRoute>} />
          <Route path="/opportunities" element={<OpportunityWorkspaceRoute><Opportunities /></OpportunityWorkspaceRoute>} />
          <Route path="/opportunities/:workspaceId" element={<OpportunityWorkspaceRoute><OpportunityDetail /></OpportunityWorkspaceRoute>} />
          <Route path="/reports" element={<OpportunityWorkspaceRoute><Reports /></OpportunityWorkspaceRoute>} />
          <Route path="/reports/:reportId" element={<OpportunityWorkspaceRoute><ReportDetail /></OpportunityWorkspaceRoute>} />
          <Route path="/reports/:reportId/versions/:reportVersionId" element={<OpportunityWorkspaceRoute><ReportDetail /></OpportunityWorkspaceRoute>} />
          <Route path="/activity" element={<OpportunityWorkspaceRoute><ActivityFeed /></OpportunityWorkspaceRoute>} />
          <Route path="/activity/:activityEventId/affected" element={<OpportunityWorkspaceRoute><ActivityFeed /></OpportunityWorkspaceRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
