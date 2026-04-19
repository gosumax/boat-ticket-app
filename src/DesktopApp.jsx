import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { OwnerDataProvider } from './contexts/OwnerDataContext';
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
import SellerTelegramRequests from './views/SellerTelegramRequests';
import DispatcherShiftClose from './views/DispatcherShiftClose';
import TelegramMiniApp from './telegram/TelegramMiniApp';
import {
  hasTelegramMiniAppLaunchHint,
  resolveTelegramMiniAppLaunchTarget,
} from './telegram/mini-app-identity.js';
import AdminTelegramContentManagementView from './telegram/AdminTelegramContentManagementView';
import AdminTelegramSourceManagementView from './telegram/AdminTelegramSourceManagementView';
import AdminTelegramAnalyticsView from './telegram/AdminTelegramAnalyticsView';
import { SellerTelegramRequestsProvider } from './components/seller/telegram/SellerTelegramRequestsContext';

// Owner UI (lazy-loaded to keep buyer Mini App bootstrap lightweight on WebKit)
const OwnerView = lazy(() => import('./views/OwnerView'));
const OwnerMoneyView = lazy(() => import('./views/OwnerMoneyView'));

// Role redirect
const RoleHomeRedirect = () => {
  const { currentUser, loadingAuth } = useAuth();

  if (hasTelegramMiniAppLaunchHint()) {
    return <Navigate to={resolveTelegramMiniAppLaunchTarget()} replace />;
  }
  if (loadingAuth) return null;
  if (!currentUser) return <Navigate to="/login" replace />;

  const role = (currentUser.role || '').toLowerCase();

  if (role === 'owner') return <Navigate to="/owner-ui" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'dispatcher') return <Navigate to="/dispatcher" replace />;
  if (role === 'seller') return <Navigate to="/seller" replace />;

  return <Navigate to="/unauthorized" replace />;
};

function DesktopApp() {
  return (
    <OwnerDataProvider>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/telegram/mini-app/*" element={<TelegramMiniApp />} />

        {/* Entry */}
        <Route path="/" element={<RoleHomeRedirect />} />
        <Route path="*" element={<RoleHomeRedirect />} />

        {/* Seller */}
        <Route
          path="/seller/*"
          element={
            <ProtectedRoute requiredRole="seller">
              <SellerTelegramRequestsProvider>
                <SellerView />
              </SellerTelegramRequestsProvider>
            </ProtectedRoute>
          }
        />
        <Route
          path="/seller/home"
          element={
            <ProtectedRoute requiredRole="seller">
              <SellerTelegramRequestsProvider>
                <SellerHome />
              </SellerTelegramRequestsProvider>
            </ProtectedRoute>
          }
        />
        <Route
          path="/seller/earnings"
          element={
            <ProtectedRoute requiredRole="seller">
              <SellerTelegramRequestsProvider>
                <SellerEarnings />
              </SellerTelegramRequestsProvider>
            </ProtectedRoute>
          }
        />
        <Route
          path="/seller/media"
          element={
            <ProtectedRoute requiredRole="seller">
              <SellerTelegramRequestsProvider>
                <SellerMedia />
              </SellerTelegramRequestsProvider>
            </ProtectedRoute>
          }
        />
        <Route
          path="/seller/telegram-requests"
          element={
            <ProtectedRoute requiredRole="seller">
              <SellerTelegramRequestsProvider>
                <SellerTelegramRequests />
              </SellerTelegramRequestsProvider>
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
          path="/admin/telegram-sources"
          element={
            <ProtectedRoute requiredRole={['admin', 'owner', 'super-admin', 'super_admin']}>
              <AdminTelegramSourceManagementView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/telegram-analytics"
          element={
            <ProtectedRoute requiredRole={['admin', 'owner', 'super-admin', 'super_admin']}>
              <AdminTelegramAnalyticsView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/telegram-content"
          element={
            <ProtectedRoute requiredRole={['admin', 'owner', 'super-admin', 'super_admin']}>
              <AdminTelegramContentManagementView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminView />
            </ProtectedRoute>
          }
        />

        {/* Owner UI (frontend only) */}
        <Route
          path="/owner-ui"
          element={
            <ProtectedRoute requiredRole="owner">
              <Suspense fallback={null}>
                <OwnerView />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/owner-ui/money"
          element={
            <ProtectedRoute requiredRole="owner">
              <Suspense fallback={null}>
                <OwnerMoneyView />
              </Suspense>
            </ProtectedRoute>
          }
        />
      </Routes>
    </OwnerDataProvider>
  );
}

export default DesktopApp;
