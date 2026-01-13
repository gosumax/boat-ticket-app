import { useState, useEffect } from 'react';
import apiClient from '../../utils/apiClient';
import { formatRUB } from '../../utils/currency';
import { getSlotAvailable } from '../../utils/slotAvailability';
import ClearTripsButton from './ClearTripsButton';

// Single source of truth for boat types
const BOAT_TYPES = [
  { value: "speed", label: "Скоростная" },
  { value: "cruise", label: "Прогулочная" },
  { value: "banana", label: "Банан" },
];

const BoatManagement = () => {
  const [boats, setBoats] = useState([]);
  const [boatSlots, setBoatSlots] = useState({}); // Store slots for each boat by boatId
  const [boatErrors, setBoatErrors] = useState({}); // Store errors for each boat by boatId
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newBoat, setNewBoat] = useState({ name: '', type: 'speed' });
  const [showArchived, setShowArchived] = useState(false); // Toggle to show archived boats
  
  // Modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBoatId, setDeleteBoatId] = useState(null);
  const [editingBoat, setEditingBoat] = useState(null);
  const [scheduleBoatId, setScheduleBoatId] = useState(null);
  const [newSlotForm, setNewSlotForm] = useState({ time: '', price: '', capacity: '', duration_minutes: 60 }); // Form for adding new slots
  const [slotDefaults, setSlotDefaults] = useState({}); // Store default prices from boats for slot creation
  
  // Notification state
  const [notification, setNotification] = useState({ show: false, type: '', message: '' });

  // Fetch boats
  useEffect(() => {
    fetchBoats();
  }, []);
  
  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (notification.show) {
      const timer = setTimeout(() => {
        setNotification({ show: false, type: '', message: '' });
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [notification.show]);

  const fetchBoats = async () => {
    setLoading(true);
    setError('');
    try {
      const boatsData = await apiClient.getBoats();
      setBoats(boatsData);
    } catch (err) {
      setError(err.message || 'Failed to fetch boats');
    } finally {
      setLoading(false);
    }
  };

  // Fetch slots for a specific boat
  const fetchBoatSlots = async (boatId) => {
    try {
      const slotsData = await apiClient.getBoatSlots(boatId);
      setBoatSlots(prev => ({ ...prev, [boatId]: slotsData }));
      setBoatErrors(prev => ({ ...prev, [boatId]: null })); // Clear any previous errors
    } catch (err) {
      setBoatErrors(prev => ({ ...prev, [boatId]: err.message || 'Failed to fetch boat slots' }));
    }
  };

  const handleCreateBoat = async (e) => {
    e.preventDefault();
    if (!newBoat.name.trim()) return;

    // Validate boat type
    if (!['speed', 'cruise', 'banana'].includes(newBoat.type)) {
      setError('Invalid boat type. Must be "speed", "cruise", or "banana"');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const boatData = {
        name: newBoat.name.trim(),
        type: newBoat.type
      };
      const newBoatResponse = await apiClient.createBoat(boatData);
      setBoats([...boats, newBoatResponse.boat]);
      setNewBoat({ name: '', type: 'speed' });
    } catch (err) {
      setError(err.message || 'Failed to create boat');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBoat = async (e) => {
    e.preventDefault();
    if (!editingBoat.name.trim()) return;

    // Validate boat type
    if (!['speed', 'cruise', 'banana'].includes(editingBoat.type)) {
      setError('Invalid boat type. Must be "speed", "cruise", or "banana"');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const updatedBoat = await apiClient.updateBoat(editingBoat.id, { 
        name: editingBoat.name,
        type: editingBoat.type
      });
      setBoats(boats.map(boat => boat.id === updatedBoat.id ? updatedBoat : boat));
      setShowEditModal(false);
      setEditingBoat(null);
    } catch (err) {
      setError(err.message || 'Failed to update boat');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBoatActive = async (boatId, isActive) => {
    setLoading(true);
    setError('');
    
    try {
      const response = await apiClient.toggleBoatActive(boatId, !isActive);
      // Extract the boat from the response
      const updatedBoat = response.boat;
      setBoats(boats.map(boat => boat.id === boatId ? updatedBoat : boat));
    } catch (err) {
      setError(err.message || 'Failed to update boat status');
    } finally {
      setLoading(false);
    }
  };

  // Handle deleting a boat
  const handleDeleteBoat = async (boatId) => {
    // Set the boat ID to delete and show confirmation modal
    setDeleteBoatId(boatId);
    setShowDeleteConfirm(true);
  };

  // Execute the boat deletion after confirmation
  const confirmDeleteBoat = async () => {
    if (!deleteBoatId) return;
    
    setShowDeleteConfirm(false);
    setLoading(true);
    setError('');

    try {
      const response = await apiClient.deleteBoat(deleteBoatId);
      
      if (response.ok) {
        if (response.slots !== undefined && response.presales !== undefined) {
          // Soft deletion - boat has dependencies
          setBoats(prev => prev.map(boat => 
            boat.id === deleteBoatId ? { ...boat, is_active: 0 } : boat
          ));
          
          // Show user-friendly message
          const slotsCount = response.slots || 0;
          const presalesCount = response.presales || 0;
          setNotification({ 
            show: true, 
            type: 'info', 
            message: `Лодка отправлена в архив (есть рейсы/продажи). Слотов: ${slotsCount}, Продаж: ${presalesCount}`
          });
        } else {
          // Hard deletion - boat had no dependencies
          setBoats(prev => prev.filter(boat => boat.id !== deleteBoatId));
          setNotification({ 
            show: true, 
            type: 'success', 
            message: 'Лодка удалена'
          });
        }
      } else {
        // Fallback: refresh the list
        fetchBoats();
      }
    } catch (err) {
      // Check if it's a 409 conflict error
      if (err.status === 409) {
        setNotification({ 
          show: true, 
          type: 'error', 
          message: 'Нельзя удалить лодку: есть связанные данные'
        });
      } else {
        setNotification({ 
          show: true, 
          type: 'error', 
          message: err.message || 'Не удалось удалить лодку. Попробуйте ещё раз.'
        });
      }
    } finally {
      setLoading(false);
      setDeleteBoatId(null);
    }
  };

  // Handle creating a new slot for a boat
  const handleCreateSlot = async (boatId, e) => {
    e.preventDefault();
    if (!newSlotForm.time.trim() || !newSlotForm.capacity) return;

    setLoading(true);
    setBoatErrors(prev => ({ ...prev, [boatId]: null })); // Clear any previous errors
    try {
      // Determine duration based on boat type
      const boat = boats.find(b => b.id === boatId);
      const durationValue = boat?.type === 'banana' ? 40 : parseInt(newSlotForm.duration_minutes);
      
      const slotData = await apiClient.createBoatSlot(boatId, {
        time: newSlotForm.time,
        price: parseInt(newSlotForm.price) || 0, // Legacy price field for compatibility
        capacity: parseInt(newSlotForm.capacity),
        duration_minutes: durationValue,
        price_adult: newSlotForm.price_adult ? parseFloat(newSlotForm.price_adult) : null,
        price_teen: newSlotForm.price_teen ? parseFloat(newSlotForm.price_teen) : null,
        price_child: newSlotForm.price_child ? parseFloat(newSlotForm.price_child) : null
      });
      
      // Update the slots for this boat
      setBoatSlots(prev => ({
        ...prev,
        [boatId]: [...(prev[boatId] || []), slotData]
      }));
      
      // Clear the form
      setNewSlotForm({ time: '', price: '', capacity: '', duration_minutes: 60 });
    } catch (err) {
      setBoatErrors(prev => ({ ...prev, [boatId]: err.message || 'Failed to create slot' }));
    } finally {
      setLoading(false);
    }
  };

  // Handle toggling slot active status
  const handleToggleSlotActive = async (boatId, slotId, isActive) => {
    setLoading(true);
    setBoatErrors(prev => ({ ...prev, [boatId]: null })); // Clear any previous errors
    try {
      const updatedSlot = await apiClient.toggleBoatSlotActive(slotId, !isActive);
      
      // Update the slots for this boat
      setBoatSlots(prev => ({
        ...prev,
        [boatId]: prev[boatId].map(slot => slot.id === slotId ? updatedSlot : slot)
      }));
    } catch (err) {
      setBoatErrors(prev => ({ ...prev, [boatId]: err.message || 'Failed to update slot status' }));
    } finally {
      setLoading(false);
    }
  };

  // Open edit modal
  const openEditModal = (boat) => {
    // When loading an existing boat into the form, set the select value from boat.type exactly
    // If boat.type is missing/invalid, default to "cruise" but DO NOT overwrite unless user saves
    const boatType = boat.type && ['speed', 'cruise', 'banana'].includes(boat.type) ? boat.type : 'cruise';
    setEditingBoat({ 
      id: boat.id, 
      name: boat.name, 
      type: boatType
    });
    setShowEditModal(true);
  };

  // Open schedule modal
  const openScheduleModal = async (boatId) => {
    setScheduleBoatId(boatId);
    if (!boatSlots[boatId]) {
      await fetchBoatSlots(boatId);
    }
    
    // Fetch boat defaults for slot creation
    const boat = boats.find(b => b.id === boatId);
    if (boat) {
      // No boat defaults since boats no longer store prices
      setSlotDefaults({});
      
      // Pre-fill the form with default values
      setNewSlotForm({
        time: '',
        price: '',
        capacity: boat.type === 'banana' ? '12' : '',
        duration_minutes: boat.type === 'banana' ? 40 : 60, // Default to 40 for banana, 60 for others
        price_adult: '',
        price_teen: '',
        price_child: ''
      });
    }
    
    setShowScheduleModal(true);
  };

  // Close modals
  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingBoat(null);
  };

  const closeScheduleModal = () => {
    setShowScheduleModal(false);
    setScheduleBoatId(null);
  };

  // Helper function to get boat type label
  const getBoatTypeLabel = (type) => {
    const boatType = BOAT_TYPES.find(t => t.value === type);
    return boatType ? boatType.label : type;
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="mb-6 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Boats List - Compact Card Layout */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Список лодок</h2>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="form-checkbox h-4 w-4 text-purple-600"
              />
              <span className="text-sm text-gray-700">Показать архив</span>
            </label>
            {/* Clear All Trips Button */}
            <div>
              <ClearTripsButton onClearComplete={fetchBoats} />
            </div>
          </div>
        </div>
        
        {loading && boats.length === 0 ? (
          <div className="text-center py-4">Загрузка...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {boats
              .filter(boat => showArchived || boat.is_active === 1)
              .map(boat => (
                <div key={boat.id} className="border border-gray-200 rounded-lg p-4 shadow-sm">
                  {/* Compact Header */}
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-base font-semibold text-gray-800 truncate">{boat.name}</h3>
                    {/* Status Icon Only */}
                    <span className="text-lg">
                      {boat.is_active ? '✅' : '❌'}
                    </span>
                  </div>
                  
                  {/* Boat Type - Restore original style */}
                  <div className="mb-3">
                    <span className="text-sm text-gray-500 mt-1">
                      {getBoatTypeLabel(boat.type)}
                    </span>
                    {boat.is_active === 0 && (
                      <span className="text-xs text-gray-500 ml-2">(Архив)</span>
                    )}
                  </div>
                  
                  {/* Compact Action Buttons - Restore original layout */}
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => openEditModal(boat)}
                      className="flex items-center justify-center px-2 py-2 text-sm font-medium bg-blue-100 text-blue-800 rounded hover:bg-blue-200 min-h-[40px]"
                      title="Редактировать"
                    >
                      <span>✏️</span>
                    </button>
                    
                    <button
                      onClick={() => openScheduleModal(boat.id)}
                      className="flex items-center justify-center px-2 py-2 text-sm font-medium bg-purple-100 text-purple-800 rounded hover:bg-purple-200 min-h-[40px]"
                      title="Расписание"
                    >
                      <span>⏰</span>
                    </button>
                    
                    <button
                      onClick={() => handleToggleBoatActive(boat.id, boat.is_active)}
                      className={`flex items-center justify-center px-2 py-2 text-sm font-medium rounded min-h-[40px] ${
                        boat.is_active 
                          ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' 
                          : 'bg-green-100 text-green-800 hover:bg-green-200'
                      }`}
                      title={boat.is_active ? 'Снять с продаж' : 'В продажу'}
                    >
                      <span>{boat.is_active ? '❌' : '▶'}</span>
                    </button>
                    
                    <button
                      onClick={() => handleDeleteBoat(boat.id)}
                      className="flex items-center justify-center px-2 py-2 text-sm font-medium bg-red-100 text-red-800 rounded hover:bg-red-200 min-h-[40px]"
                      title="Удалить"
                    >
                      <span>🗑</span>
                    </button>
                  </div>
                </div>
              ))
            }
            {boats.filter(boat => showArchived || boat.is_active === 1).length === 0 && (
              <div className="col-span-full text-center py-4 text-gray-500">
                {showArchived ? 'Архив пуст' : 'Лодки не найдены'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Boat Form - Moved below boats list */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">Добавить лодку</h2>
          <button
            onClick={handleCreateBoat}
            disabled={loading}
            className={`px-4 py-2 bg-purple-600 text-white rounded-lg font-medium min-h-[44px] ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-700'}`}
          >
            Добавить
          </button>
        </div>
        <form onSubmit={handleCreateBoat} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newBoat.name}
            onChange={(e) => setNewBoat({ ...newBoat, name: e.target.value })}
            placeholder="Название лодки"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg min-h-[44px]"
            required
          />
          <select
            value={newBoat.type}
            onChange={(e) => setNewBoat({ ...newBoat, type: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg min-h-[44px]"
          >
            {BOAT_TYPES.map(boatType => (
              <option key={boatType.value} value={boatType.value}>
                {boatType.label}
              </option>
            ))}
          </select>

        </form>
      </div>

      {/* Edit Boat Modal */}
      {showEditModal && editingBoat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-md">
            <div className="p-5">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">Редактировать лодку</h2>
                <button 
                  onClick={closeEditModal}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  &times;
                </button>
              </div>
              
              <form onSubmit={handleUpdateBoat}>
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Название
                  </label>
                  <input
                    type="text"
                    value={editingBoat.name}
                    onChange={(e) => setEditingBoat({ ...editingBoat, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Тип
                  </label>
                  <select
                    value={editingBoat.type}
                    onChange={(e) => setEditingBoat({ ...editingBoat, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {BOAT_TYPES.map(boatType => (
                      <option key={boatType.value} value={boatType.value}>
                        {boatType.label}
                      </option>
                    ))}
                  </select>
                </div>
                

                
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-400 min-h-[40px]"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className={`px-4 py-2 bg-purple-600 text-white rounded-lg font-medium min-h-[40px] ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-700'}`}
                  >
                    Сохранить
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && scheduleBoatId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">Расписание / Рейсы</h2>
                <button 
                  onClick={closeScheduleModal}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  &times;
                </button>
              </div>
              
              {/* Error message for this boat */}
              {boatErrors[scheduleBoatId] && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                  {boatErrors[scheduleBoatId]}
                </div>
              )}
              
              {/* Create Slot Form */}
              <div className="mb-5 p-3 bg-gray-50 rounded-lg">
                <h3 className="font-medium mb-2 text-sm">Добавить рейс</h3>
                <form onSubmit={(e) => handleCreateSlot(scheduleBoatId, e)} className="space-y-2">
                  <div className="flex space-x-2">
                    <div className="flex-1">
                      <label className="block text-gray-700 text-xs font-bold mb-1">
                        Время
                      </label>
                      <input
                        type="time"
                        value={newSlotForm.time}
                        onChange={(e) => setNewSlotForm({ ...newSlotForm, time: e.target.value })}
                        className="w-full px-2 py-2 border border-gray-300 rounded text-sm min-h-[36px]"
                        required
                      />
                    </div>
                    
                    <div className="flex-1">
                      <label className="block text-gray-700 text-xs font-bold mb-1">
                        Вместимость
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={newSlotForm.capacity}
                        onChange={(e) => setNewSlotForm({ ...newSlotForm, capacity: e.target.value })}
                        placeholder={(() => {
                          const currentBoat = boats.find(b => b.id === scheduleBoatId);
                          if (currentBoat && currentBoat.type === 'banana') {
                            return 'Вместимость (12 для банана)';
                          }
                          return 'Вместимость';
                        })()}
                        className="w-full px-2 py-2 border border-gray-300 rounded text-sm min-h-[36px]"
                        required
                      />
                    </div>
                  </div>
                  
                  {/* Duration selector - hide for banana boats */}
                  {(() => {
                    const currentBoat = boats.find(b => b.id === scheduleBoatId);
                    if (currentBoat && currentBoat.type !== 'banana') {
                      return (
                        <div className="mt-2">
                          <label className="block text-gray-700 text-xs font-bold mb-1">
                            Длительность рейса
                          </label>
                          <select
                            value={newSlotForm.duration_minutes}
                            onChange={(e) => setNewSlotForm({ ...newSlotForm, duration_minutes: parseInt(e.target.value) })}
                            className="w-full px-2 py-2 border border-gray-300 rounded text-sm min-h-[36px]"
                          >
                            <option value={60}>1 час</option>
                            <option value={120}>2 часа</option>
                            <option value={180}>3 часа</option>
                          </select>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  
                  {/* Pricing fields based on boat type */}
                  {(() => {
                    const currentBoat = boats.find(b => b.id === scheduleBoatId);
                    if (currentBoat) {
                      return (
                        <div className="mt-2">
                          <div className="text-xs text-gray-500 mb-1">Цены (установите для рейса):</div>
                          <div className="flex flex-wrap gap-2">
                            <div className="flex-1 min-w-[100px]">
                              <label className="block text-xs text-gray-600 mb-1">Взрослый</label>
                              <input
                                type="number"
                                value={newSlotForm.price_adult || ''}
                                onChange={(e) => setNewSlotForm({ ...newSlotForm, price_adult: e.target.value })}
                                placeholder="Цена взр."
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-center"
                              />
                            </div>
                            {currentBoat.type !== 'banana' && (
                              <div className="flex-1 min-w-[100px]">
                                <label className="block text-xs text-gray-600 mb-1">Подросток</label>
                                <input
                                  type="number"
                                  value={newSlotForm.price_teen || ''}
                                  onChange={(e) => setNewSlotForm({ ...newSlotForm, price_teen: e.target.value })}
                                  placeholder="Цена подр."
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-center"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-[100px]">
                              <label className="block text-xs text-gray-600 mb-1">Ребенок</label>
                              <input
                                type="number"
                                value={newSlotForm.price_child || ''}
                                onChange={(e) => setNewSlotForm({ ...newSlotForm, price_child: e.target.value })}
                                placeholder="Цена реб."
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-center"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  
                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full px-3 py-2 bg-purple-600 text-white rounded-lg font-medium text-sm min-h-[36px] ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-700'}`}
                  >
                    Добавить рейс
                  </button>
                </form>
              </div>
              
              {/* Slots List */}
              <div>
                <h3 className="font-medium mb-2 text-sm">Список рейсов</h3>
                <div className="space-y-2">
                  {boatSlots[scheduleBoatId] && boatSlots[scheduleBoatId].length > 0 ? (
                    boatSlots[scheduleBoatId].map(slot => (
                      <div key={slot.id} className="border border-gray-200 rounded-lg p-3 flex justify-between items-center">
                        <div>
                          <div className="font-medium text-sm">{slot.time}</div>
                          <div className="text-gray-600 text-xs">{formatRUB(slot.price)}</div>
                          {slot.capacity && (
                            <div className="text-gray-500 text-xs">Вместимость: {slot.capacity}</div>
                          )}
                          {slot.duration_minutes && (
                            <div className="text-gray-500 text-xs">⏱ {Math.ceil(slot.duration_minutes / 60)}ч</div>
                          )}
                          <div className="text-gray-500 text-xs">Свободно: {getSlotAvailable(slot)}</div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <span className="text-xs">
                            {slot.is_active ? '✅' : '❌'}
                          </span>
                          <button
                            onClick={() => handleToggleSlotActive(scheduleBoatId, slot.id, slot.is_active)}
                            className={`px-2 py-1 text-xs rounded font-medium min-h-[28px] ${
                              slot.is_active 
                                ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' 
                                : 'bg-green-100 text-green-800 hover:bg-green-200'
                            }`}
                          >
                            {slot.is_active ? 'Откл' : 'Вкл'}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : boatSlots[scheduleBoatId] ? (
                    <div className="text-center py-3 text-gray-500 text-sm">
                      Рейсы не добавлены
                    </div>
                  ) : (
                    <div className="text-center py-3 text-gray-500 text-sm">
                      Ошибка загрузки рейсов
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Confirmation Modal for Boat Deletion */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-md p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-800">Подтверждение удаления</h2>
            </div>
            <p className="mb-6 text-gray-700">Удалить лодку? Если есть рейсы или продажи, лодка будет отправлена в архив.</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteBoatId(null);
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-400 min-h-[40px]"
              >
                Отмена
              </button>
              <button
                onClick={confirmDeleteBoat}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 min-h-[40px]"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Notification Toast */}
      {notification.show && (
        <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 max-w-sm ${
          notification.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 
          notification.type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' : 
          'bg-blue-100 text-blue-800 border border-blue-200'
        }`}>
          <div className="flex justify-between items-start">
            <span>{notification.message}</span>
            <button 
              onClick={() => setNotification({ show: false, type: '', message: '' })}
              className="ml-4 text-gray-600 hover:text-gray-800 focus:outline-none"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BoatManagement;