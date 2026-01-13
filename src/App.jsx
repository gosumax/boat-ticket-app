import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Import views
import LoginPage from './views/LoginPage';
import SellerView from './views/SellerView';
import DispatcherView from './views/DispatcherView';
import AdminView from './views/AdminView';
import UnauthorizedPage from './views/UnauthorizedPage';
import SellerHome from './views/SellerHome';
import SellerEarnings from './views/SellerEarnings';
import SellerMedia from './views/SellerMedia';
import DispatcherShiftClose from './views/DispatcherShiftClose';

// Import OwnerView
import OwnerView from './views/OwnerView';
import DebugButton from './components/DebugButton';

// Component that redirects based on user role
const RoleHomeRedirect = () => {
  const { currentUser, loadingAuth } = useAuth();

  if (loadingAuth) return null;

  if (!currentUser) return <Navigate to="/login" replace />;

  const role = (currentUser.role || '').toLowerCase();

  if (role === 'owner') return <Navigate to="/owner/dashboard" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'dispatcher') return <Navigate to="/dispatcher" replace />;
  if (role === 'seller') return <Navigate to="/seller" replace />;

  return <Navigate to="/unauthorized" replace />;
};

function App() {
  return (
    <>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />

      {/* Role-based redirect */}
      <Route path="/" element={<RoleHomeRedirect />} />
      <Route path="*" element={<RoleHomeRedirect />} />

      {/* Seller routes */}
      <Route
        path="/seller/*"
        element={
          <ProtectedRoute requiredRole="seller">
            <SellerView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/seller/home"
        element={
          <ProtectedRoute requiredRole="seller">
            <SellerHome />
          </ProtectedRoute>
        }
      />
      <Route
        path="/seller/earnings"
        element={
          <ProtectedRoute requiredRole="seller">
            <SellerEarnings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/seller/media"
        element={
          <ProtectedRoute requiredRole="seller">
            <SellerMedia />
          </ProtectedRoute>
        }
      />

      {/* Dispatcher routes */}
      <Route
        path="/dispatcher/*"
        element={
          <ProtectedRoute requiredRole="dispatcher">
            <DispatcherView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dispatcher/shift-close"
        element={
          <ProtectedRoute requiredRole="dispatcher">
            <DispatcherShiftClose />
          </ProtectedRoute>
        }
      />

      {/* Admin routes */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute requiredRole="admin">
            <AdminView />
          </ProtectedRoute>
        }
      />

      {/* Owner routes - separate from admin (no ProtectedRoute) */}
      <Route path="/owner/*" element={<OwnerView />} />
    </Routes>
    <DebugButton />
    </>
  );
}

export default App;
