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

// Owner UI
import OwnerView from './views/OwnerView';
import OwnerMoneyView from './views/OwnerMoneyView';

import DebugButton from './components/DebugButton';

// Role redirect
const RoleHomeRedirect = () => {
  const { currentUser, loadingAuth } = useAuth();

  if (loadingAuth) return null;
  if (!currentUser) return <Navigate to="/login" replace />;

  const role = (currentUser.role || '').toLowerCase();

  if (role === 'owner') return <Navigate to="/owner-ui" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'dispatcher') return <Navigate to="/dispatcher" replace />;
  if (role === 'seller') return <Navigate to="/seller" replace />;

  return <Navigate to="/unauthorized" replace />;
};

function App() {
  return (
    <>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        {/* Entry */}
        <Route path="/" element={<RoleHomeRedirect />} />
        <Route path="*" element={<RoleHomeRedirect />} />

        {/* Seller */}
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

        {/* Dispatcher */}
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

        {/* Admin */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminView />
            </ProtectedRoute>
          }
        />

        {/* OWNER UI (НЕ backend) */}
        <Route
          path="/owner-ui"
          element={
            <ProtectedRoute requiredRole="owner">
              <OwnerView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/owner-ui/money"
          element={
            <ProtectedRoute requiredRole="owner">
              <OwnerMoneyView />
            </ProtectedRoute>
          }
        />
      </Routes>

      <DebugButton />
    </>
  );
}

export default App;
