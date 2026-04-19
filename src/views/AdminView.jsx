import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// import { trips, boats, sellers } from '../data/mockData'; // Commented out to prevent crashes
import { formatRUB } from '../utils/currency';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../utils/apiClient';
import BoatManagement from '../components/admin/BoatManagement';
import WorkingZoneMap from '../components/admin/WorkingZoneMap';

const createEmptyUserForm = () => ({
  username: '',
  password: '',
  role: 'seller',
  public_display_name: '',
  public_phone_e164: '',
});

const isSellerRole = (role) => role === 'seller';

const AdminView = () => {
  const navigate = useNavigate();
  const { logout: authLogout, currentUser, loading: authLoading } = useAuth();

  const logout = () => {
    authLogout();
    navigate('/login', { replace: true });
  };

  // Redirect to login if user is not authenticated
  useEffect(() => {
    if (!authLoading && !currentUser) {
      navigate('/login', { replace: true });
    }
  }, [currentUser, authLoading, navigate]);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedProfileUserId, setSavedProfileUserId] = useState(null);
  const [newUser, setNewUser] = useState(createEmptyUserForm);

  // Dashboard stats state
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalTicketsSold, setTotalTicketsSold] = useState(0);
  const [speedTickets, setSpeedTickets] = useState(0);
  const [cruiseTickets, setCruiseTickets] = useState(0);
  const [sellerStats, setSellerStats] = useState([]);

  // Fetch dashboard stats
  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchDashboardStats();
    }
  }, [activeTab]);

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);
      // Fetch stats via admin API
      const statsData = await apiClient.get('/admin/stats');
      
      setTotalRevenue(statsData.totalRevenue || 0);
      setTotalTicketsSold(statsData.totalTicketsSold || 0);
      setSpeedTickets(statsData.speedTrips || 0);
      setCruiseTickets(statsData.cruiseTrips || 0);
      
      // Fetch seller stats
      const sellersData = await apiClient.getSellers();
      setSellerStats(sellersData);
      
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
      setError(err.message || 'Failed to fetch dashboard stats');
      // Set defaults to prevent crashes
      setTotalRevenue(0);
      setTotalTicketsSold(0);
      setSpeedTickets(0);
      setCruiseTickets(0);
      setSellerStats([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch users
  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!savedProfileUserId) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setSavedProfileUserId(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [savedProfileUserId]);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/users');

const usersData = Array.isArray(res)
  ? res
  : Array.isArray(res?.data)
    ? res.data
    : [];

setUsers(
  usersData.map((user) => ({
    ...user,
    public_display_name: user.public_display_name || '',
    public_phone_e164: user.public_phone_e164 || '',
  }))
);

    } catch (err) {
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const userData = await apiClient.createUser(newUser);
      setUsers((currentUsers) => [
        ...currentUsers,
        {
          ...userData,
          public_display_name: userData.public_display_name || '',
          public_phone_e164: userData.public_phone_e164 || '',
        },
      ]);
      setNewUser(createEmptyUserForm());
    } catch (err) {
      setError(err.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const handleSellerFieldChange = (userId, field, value) => {
    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === userId
          ? {
              ...user,
              [field]: value,
            }
          : user
      )
    );
  };

  const handleSaveSellerProfile = async (user) => {
    setLoading(true);
    setError('');
    setSavedProfileUserId(null);
    try {
      const updatedUser = await apiClient.updateUser(user.id, {
        public_display_name: user.public_display_name,
        public_phone_e164: user.public_phone_e164,
      });
      setUsers((currentUsers) =>
        currentUsers.map((item) => (item.id === user.id ? updatedUser : item))
      );
      setSavedProfileUserId(user.id);
    } catch (err) {
      setError(err.message || 'Failed to update seller public profile');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserStatus = async (userId, isActive) => {
    setLoading(true);
    setError('');
    try {
      const updatedUser = await apiClient.updateUser(userId, { is_active: isActive ? 1 : 0 });
      setUsers((currentUsers) =>
        currentUsers.map((user) => (user.id === userId ? updatedUser : user))
      );
    } catch (err) {
      setError(err.message || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (userId) => {
    const newPassword = prompt('Введите новый пароль:');
    if (!newPassword) return;
    
    setLoading(true);
    setError('');
    try {
      await apiClient.resetPassword(userId, newPassword);
      alert('Пароль успешно сброшен');
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm('Удалить пользователя? Действие необратимо')) return;
    try {
      await apiClient.deleteUser(id);
      await fetchUsers(); // Reload users list
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-purple-600 text-white p-4 flex justify-between items-center shadow-md">
        <button 
          onClick={() => navigate('/')} 
          className="text-white hover:text-purple-200 transition-colors"
        >
          ← Назад
        </button>
        <h1 className="text-xl font-bold">Панель управления</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/admin/telegram-sources')}
            className="bg-purple-500 hover:bg-purple-400 text-white px-3 py-1 rounded font-medium transition-colors"
          >
            Telegram Sources
          </button>
          <button
            onClick={() => navigate('/admin/telegram-content')}
            className="bg-purple-500 hover:bg-purple-400 text-white px-3 py-1 rounded font-medium transition-colors"
          >
            Telegram CMS
          </button>
          <button 
            onClick={logout}
            className="bg-purple-700 hover:bg-purple-800 text-white px-3 py-1 rounded font-medium transition-colors"
          >
          Выйти
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4 max-w-[1600px] mx-auto w-full" data-testid="admin-main-container">
        <div className="flex border-b border-gray-200 mb-6">
          <button
            className={`py-2 px-4 font-medium ${activeTab === 'dashboard' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Статистика
          </button>
          <button
            className={`py-2 px-4 font-medium ${activeTab === 'boats' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('boats')}
          >
            Лодки
          </button>
          <button
            className={`py-2 px-4 font-medium ${activeTab === 'zone' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('zone')}
          >
            Рабочая зона
          </button>
          <button
            className={`py-2 px-4 font-medium ${activeTab === 'users' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('users')}
            data-testid="admin-tab-users"
          >
            Пользователи
          </button>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-100 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <div className="space-y-6">
            {/* Dashboard Stats */}
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-gray-600 text-sm">Выручка сегодня</h3>
                <p className="text-2xl font-bold text-purple-600">{formatRUB(totalRevenue)}</p>
              </div>
              
              <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-gray-600 text-sm">Продано билетов</h3>
                <p className="text-2xl font-bold text-purple-600">{totalTicketsSold}</p>
              </div>
              
              <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-gray-600 text-sm">Скоростные / Прогулочные</h3>
                <p className="text-2xl font-bold text-purple-600">{speedTickets} / {cruiseTickets}</p>
              </div>
            </div>

            {/* Sellers Table */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Продавцы</h2>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-gray-600 font-medium">Продавец</th>
                      <th className="text-right py-2 text-gray-600 font-medium">Продажи (₽)</th>
                      <th className="text-right py-2 text-gray-600 font-medium">Комиссия (₽)</th>
                      <th className="text-right py-2 text-gray-600 font-medium">К выплате (₽)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellerStats.map(seller => (
                      <tr key={seller.id} className="border-b">
                        <td className="py-3">{seller.name}</td>
                        <td className="text-right py-3">{formatRUB(seller.soldAmount)}</td>
                        <td className="text-right py-3">{formatRUB(seller.commission)}</td>
                        <td className="text-right py-3 font-bold text-purple-600">{formatRUB(seller.totalToPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : activeTab === 'boats' ? (
          <BoatManagement />
        ) : activeTab === 'zone' ? (
          <WorkingZoneMap />
        ) : (
          <div
            className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start"
            data-testid="admin-users-layout"
          >
            {/* Create User Form */}
            <div className="bg-white rounded-xl shadow-md p-6" data-testid="admin-users-create-block">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Создать пользователя</h2>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-gray-700 font-medium mb-2">Логин</label>
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-700 font-medium mb-2">Пароль</label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-700 font-medium mb-2">Роль</label>
                  <select
                    value={newUser.role}
                    onChange={(e) =>
                      setNewUser((currentUser) => ({
                        ...currentUser,
                        role: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="seller">Продавец</option>
                    <option value="dispatcher">Диспетчер</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>
                {isSellerRole(newUser.role) && (
                  <>
                    <div>
                      <label className="block text-gray-700 font-medium mb-2">
                        Публичное имя продавца
                      </label>
                      <input
                        type="text"
                        value={newUser.public_display_name}
                        onChange={(e) =>
                          setNewUser({
                            ...newUser,
                            public_display_name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        placeholder="Например, Анна Соколова"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-2">
                        Телефон продавца
                      </label>
                      <input
                        type="tel"
                        value={newUser.public_phone_e164}
                        onChange={(e) =>
                          setNewUser({
                            ...newUser,
                            public_phone_e164: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        placeholder="+79991234567"
                        required
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Этот телефон увидит покупатель в Telegram Mini App.
                      </p>
                    </div>
                  </>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className={`px-4 py-2 bg-purple-600 text-white rounded-lg font-medium ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-700'}`}
                >
                  {loading ? 'Создание...' : 'Создать'}
                </button>
              </form>
            </div>

            {/* Users List */}
            <div className="bg-white rounded-xl shadow-md p-6" data-testid="admin-users-list-block">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Список пользователей</h2>
              
              {loading && users.length === 0 ? (
                <div className="text-center py-4">Загрузка...</div>
              ) : (
                <div className="overflow-x-auto" data-testid="admin-users-table-scroll-area">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-gray-600 font-medium">Логин</th>
                        <th className="text-left py-2 text-gray-600 font-medium">Роль</th>
                        <th className="text-left py-2 text-gray-600 font-medium">Публичное имя</th>
                        <th className="text-left py-2 text-gray-600 font-medium">Телефон</th>
                        <th className="text-left py-2 text-gray-600 font-medium">Статус</th>
                        <th className="text-left py-2 text-gray-600 font-medium">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => (
                        <tr key={user.id} className="border-b">
                          <td className="py-3">{user.username}</td>
                          <td className="py-3">
                            {user.role === 'seller' && 'Продавец'}
                            {user.role === 'dispatcher' && 'Диспетчер'}
                            {user.role === 'admin' && 'Администратор'}
                          </td>
                          <td className="py-3 align-top">
                            {isSellerRole(user.role) ? (
                              <input
                                type="text"
                                value={user.public_display_name || ''}
                                onChange={(e) =>
                                  handleSellerFieldChange(
                                    user.id,
                                    'public_display_name',
                                    e.target.value
                                  )
                                }
                                className="w-full min-w-40 px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="Публичное имя"
                              />
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 align-top">
                            {isSellerRole(user.role) ? (
                              <input
                                type="tel"
                                value={user.public_phone_e164 || ''}
                                onChange={(e) =>
                                  handleSellerFieldChange(
                                    user.id,
                                    'public_phone_e164',
                                    e.target.value
                                  )
                                }
                                className="w-full min-w-40 px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="+79991234567"
                              />
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {user.is_active ? 'Активен' : 'Отключен'}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => handleToggleUserStatus(user.id, user.is_active)}
                                className={`px-3 py-1 text-xs rounded font-medium ${user.is_active ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' : 'bg-green-100 text-green-800 hover:bg-green-200'}`}
                              >
                                {user.is_active ? 'Отключить' : 'Включить'}
                              </button>
                              <button
                                onClick={() => handleResetPassword(user.id)}
                                className="px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded font-medium hover:bg-blue-200"
                              >
                                Сбросить пароль
                              </button>
                              {isSellerRole(user.role) && (
                                <button
                                  onClick={() => handleSaveSellerProfile(user)}
                                  className="px-3 py-1 text-xs bg-purple-100 text-purple-800 rounded font-medium hover:bg-purple-200"
                                  data-testid={`admin-save-profile-button-${user.id}`}
                                >
                                  Сохранить профиль
                                </button>
                              )}
                              {isSellerRole(user.role) && savedProfileUserId === user.id && (
                                <span
                                  className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded font-medium"
                                  data-testid="admin-save-profile-success"
                                >
                                  {'\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D'}
                                </span>
                              )}
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="px-3 py-1 text-xs bg-red-100 text-red-800 rounded font-medium hover:bg-red-200"
                              >
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminView;
