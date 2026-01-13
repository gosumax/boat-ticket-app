import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = ({ children, requiredRole }) => {
  const { currentUser, loadingAuth } = useAuth();
  const location = useLocation();

  if (loadingAuth) {
    return <div className="p-4">Загрузка...</div>;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  const role = currentUser.role;

  // 🔥 ЖЁСТКОЕ ПРАВИЛО: OWNER всегда может зайти в /owner
  if (role === 'owner' && location.pathname.startsWith('/owner')) {
    return children;
  }

  // Обычная проверка ролей
  if (requiredRole) {
    const allowedRoles = Array.isArray(requiredRole)
      ? requiredRole
      : [requiredRole];

    if (!allowedRoles.includes(role)) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return children;
};

export default ProtectedRoute;
