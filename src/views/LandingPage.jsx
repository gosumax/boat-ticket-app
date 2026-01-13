import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LandingPage = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  // Automatically redirect user based on their role
  useEffect(() => {
    if (currentUser) {
      switch (currentUser.role) {
        case 'seller':
          navigate('/seller/home', { replace: true });
          break;
        case 'dispatcher':
          navigate('/dispatcher', { replace: true });
          break;
        case 'admin':
        case 'owner':
          navigate('/admin', { replace: true });
          break;
        default:
          // For unknown roles, redirect to login
          navigate('/login', { replace: true });
          break;
      }
    }
  }, [currentUser, navigate]);

  // Don't render anything as users will be redirected immediately
  return null;
};

export default LandingPage;