import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../utils/apiClient';
import ConfirmCancelTripModal from './ConfirmCancelTripModal';
import { dpAlert, dpButton, dpPill } from './dispatcherTheme';
import ScheduleTemplates from './ScheduleTemplates';
import DateFieldPicker from '../ui/DateFieldPicker';
import TimeFieldPicker, { DISPATCHER_TIME_OPTIONS } from '../ui/TimeFieldPicker';

import { normalizeDate, getTodayDate, getTomorrowDate } from '../../utils/dateUtils';


function formatDurationMinutes(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

const SlotManagement = ({ onTripCancelled, dateFilter, dateFrom, dateTo, typeFilter, statusFilter, searchTerm, onTripCountsChange, shiftClosed, onDateRangeChange }) => {
  // Add state for tabs
  const [activeTab, setActiveTab] = useState('slots'); // 'slots' or 'schedule'

  const { currentUser } = useAuth();
  const defaultTripDate = useMemo(() => normalizeDate(dateFrom) || getTodayDate(), [dateFrom]);
  const timeOptions = DISPATCHER_TIME_OPTIONS;
  const [slots, setSlots] = useState([]);
  const [boats, setBoats] = useState([]);
  const [loading, setLoading] = useState(false);




  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Trip form state
  const [formData, setFormData] = useState({
    trip_date: defaultTripDate,
    boat_id: '',
    time: '',
    price_adult: '',
    price_teen: '',
    price_child: '',
    capacity: '',
    duration_minutes: '',
    active: 1
  });
  
  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [slotToCancel, setSlotToCancel] = useState(null);
  
  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [slotToDelete, setSlotToDelete] = useState(null);
  
  // Filter slots based on props from parent
  const filteredSlots = useMemo(() => {
    let result = slots;
    const normalizedDateFrom = normalizeDate(dateFrom);
    const normalizedDateTo = normalizeDate(dateTo) || normalizedDateFrom;
    
    if (normalizedDateFrom && normalizedDateTo) {
      result = result.filter(slot => {
        const slotDate = normalizeDate(slot.trip_date);
        if (!slotDate) return slot.source_type !== 'generated';
        return slotDate >= normalizedDateFrom && slotDate <= normalizedDateTo;
      });
    } else if (dateFilter !== 'all') {
      if (dateFilter === 'today') {
        const today = getTodayDate();
        result = result.filter(slot => {
          const slotDate = normalizeDate(slot.trip_date);
          return slotDate ? slotDate === today : slot.source_type !== 'generated';
        });
      } else if (dateFilter === 'tomorrow') {
        const tomorrowStr = getTomorrowDate();
        result = result.filter(slot => {
          const slotDate = normalizeDate(slot.trip_date);
          return slotDate ? slotDate === tomorrowStr : slot.source_type !== 'generated';
        });
      }
    }
    
    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter(slot => {
        const boatType = slot.boat_type || '';
        return boatType === typeFilter;
      });
    }
    
    // Status filter
    // active    = продаётся сейчас: активен + ещё не ушёл по времени
    // completed = уже ушёл по времени (только для generated slots с trip_date)
    // all       = без фильтра
    if (statusFilter !== 'all') {
      const nowMs = Date.now();
      result = result.filter(slot => {
        const isActive = Boolean(Number(slot.is_active ?? 0));
        const hasDateTime = !!slot.trip_date && !!slot.time;
        const dt = hasDateTime ? new Date(`${slot.trip_date}T${slot.time}:00`) : null;
        const finished = dt && Number.isFinite(dt.getTime()) ? dt.getTime() < nowMs : false;

        if (statusFilter === 'active') return isActive && !finished;
        if (statusFilter === 'completed') return finished;
        return true;
      });
    }
    
    // Search filter - search across relevant fields
    if (searchTerm) {
      const term = searchTerm.toLowerCase().trim();
      if (term) {
        result = result.filter(slot => {
          const boatName = (slot.boat_name || '').toLowerCase();
          const boatType = (slot.boat_type || '').toLowerCase();
          const idStr = slot.id.toString();
          const time = (slot.time || '').toLowerCase();
          
          return (
            boatName.includes(term) ||
            boatType.includes(term) ||
            idStr.includes(term) ||
            time.includes(term)
          );
        });
      }
    }
    
    return result;
  }, [slots, dateFilter, dateFrom, dateTo, typeFilter, statusFilter, searchTerm]);
  
  const totalSlots = slots.length;
  const shownSlots = filteredSlots.length;
  
  // Notify parent of slot counts when they change
  useEffect(() => {
    if (onTripCountsChange) {
      onTripCountsChange({ total: totalSlots, shown: shownSlots });
    }
  }, [totalSlots, shownSlots, onTripCountsChange]);

  // Load slots and boats
  useEffect(() => {
    loadSlotsAndBoats();
  }, []);

  const loadSlotsAndBoats = async ({ throwOnError = false } = {}) => {
    setLoading(true);
    try {
      const [slotsData, boatsData] = await Promise.all([
        apiClient.getAllDispatcherSlots(),
        apiClient.getAllDispatcherBoats()
      ]);
      setSlots(slotsData);
      setBoats(boatsData);
      return { slotsData, boatsData };
    } catch (error) {
      console.error('Error loading data:', error);
      if (throwOnError) {
        throw error;
      }
      return null;
    } finally {
      setLoading(false);
    }
  };


  const handleInputChange = (e) => {
    const { name, value } = e.target;
    // Special handling for banana boats - clear teen price when switching to banana
    if (name === 'boat_id') {
      const selectedBoat = boats.find(b => b.id === parseInt(value));
      if (selectedBoat && selectedBoat.type === 'banana') {
        setFormData(prev => ({
          ...prev,
          [name]: value,
          price_teen: '' // Clear teen price for banana boats
        }));
      } else {
        setFormData(prev => ({
          ...prev,
          [name]: value
        }));
      }
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleTripDateChange = (nextValue) => {
    const tripDate = normalizeDate(nextValue) || nextValue;
    setFormData(prev => ({
      ...prev,
      trip_date: tripDate
    }));

    if (!editingSlot && tripDate && typeof onDateRangeChange === 'function') {
      onDateRangeChange({ from: tripDate, to: tripDate });
    }
  };

  // Handle price changes for specific ticket types
  const handlePriceChange = (type, value) => {
    setFormData(prev => ({
      ...prev,
      [`price_${type}`]: value
    }));
  };

  // Helper to normalize prices to numbers
  const toInt = (v) => {
    const n = parseInt(String(v).replace(/[\D]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');

    // Get boat type for validation
    const selectedBoat = boats.find(b => b.id === parseInt(formData.boat_id));
    const isBanana = selectedBoat && selectedBoat.type === 'banana';
    
    // Normalize prices to numbers
    const priceAdult = toInt(formData.price_adult);
    const priceChild = toInt(formData.price_child);
    const priceTeen = isBanana ? null : toInt(formData.price_teen);
    
    // Validate form data
    if (editingSlot) {
      // For editing, time, capacity, and duration_minutes are required
      if (!formData.time || !formData.capacity || !formData.duration_minutes) {
        setFormError('Все поля обязательны для заполнения');
        return;
      }
      // Validate per-ticket-category prices
      if (priceAdult === null || priceAdult <= 0) {
        setFormError('Некорректная цена для взрослых');
        return;
      }
      
      if (priceChild === null || priceChild <= 0) {
        setFormError('Некорректная цена для детей');
        return;
      }
      
      // For non-banana boats, teen price is also required
      if (!isBanana && (priceTeen === null || priceTeen <= 0)) {
        setFormError('Некорректная цена для подростков');
        return;
      }
          
      // Validate time format
      if (!timeOptions.includes(formData.time)) {
        setFormError('Выберите время из списка');
        return;
      }
    } else {
      // For creating, all fields including boat_id are required
      if (!formData.trip_date || !formData.boat_id || !formData.time || !formData.capacity || !formData.duration_minutes) {
        setFormError('Все поля обязательны для заполнения');
        return;
      }
      if (!normalizeDate(formData.trip_date)) {
        setFormError('Выберите дату рейса');
        return;
      }
      
      // Validate per-ticket-category prices
      if (priceAdult === null || priceAdult <= 0) {
        setFormError('Некорректная цена для взрослых');
        return;
      }
      
      if (priceChild === null || priceChild <= 0) {
        setFormError('Некорректная цена для детей');
        return;
      }
      
      // For non-banana boats, teen price is also required
      if (!isBanana && (priceTeen === null || priceTeen <= 0)) {
        setFormError('Некорректная цена для подростков');
        return;
      }
          
      // Validate time format
      if (!timeOptions.includes(formData.time)) {
        setFormError('Выберите время из списка');
        return;
      }
    }
        
    // Get boat type to validate duration
    if (selectedBoat && selectedBoat.type === 'banana') {
      // For banana boats, duration must be 40 minutes
      if (formData.duration_minutes !== '40') {
        setFormError('Для банана длительность должна быть 40 минут');
        return;
      }
    } else {
      // For regular boats, duration must be 60, 120, or 180 minutes
      if (!['60', '120', '180'].includes(formData.duration_minutes)) {
        setFormError('Для лодок длительность должна быть 60, 120 или 180 минут');
        return;
      }
    }

    try {
      // Prepare the payload with normalized prices
      const payload = {
        time: formData.time,
        capacity: parseInt(formData.capacity),
        duration_minutes: parseInt(formData.duration_minutes),
        price_adult: priceAdult,
        price_child: priceChild,
        ...(isBanana ? {} : { price_teen: priceTeen })
      };
      

      
      if (editingSlot) {
        // Update existing slot (only time, capacity, duration_minutes, and prices - not boat or active)
        const updatedSlot = await apiClient.updateDispatcherSlot(editingSlot.id, payload);
        setSlots(prev => prev.map(slot => slot.id === updatedSlot.id ? updatedSlot : slot));
        await loadSlotsAndBoats({ throwOnError: true });
        setSuccessMessage('Рейс обновлён');
      } else {
        // Create new slot
        const createPayload = {
          ...payload,
          trip_date: normalizeDate(formData.trip_date),
          boat_id: parseInt(formData.boat_id),
          active: parseInt(formData.active)
        };
        

        const newSlot = await apiClient.createDispatcherSlot(createPayload);
        const refreshedData = await loadSlotsAndBoats({ throwOnError: true });
        const refreshedSlots = refreshedData?.slotsData || [];
        const createdSlotUid = newSlot?.slot_uid || newSlot?.slotUid || (newSlot?.id ? `manual:${newSlot.id}` : null);
        const createdTripDate = normalizeDate(formData.trip_date);
        const createdVisible = refreshedSlots.some(slot => {
          const matchesCreatedSlot = createdSlotUid
            ? (slot.slot_uid === createdSlotUid || slot.slotUid === createdSlotUid)
            : Number(slot.id) === Number(newSlot?.id) && slot.source_type === 'manual';
          return matchesCreatedSlot && normalizeDate(slot.trip_date) === createdTripDate;
        });

        if (!createdVisible) {
          throw new Error('Рейс создан, но не найден в списке выбранной даты');
        }

        setSuccessMessage('Рейс создан');
      }
      
      // Reset form
      setFormData({ trip_date: defaultTripDate, boat_id: '', time: '', price_adult: '', price_teen: '', price_child: '', capacity: '', duration_minutes: '', active: 1 });
      setShowForm(false);
      setEditingSlot(null);
    } catch (error) {
      console.error('[CREATE_SLOT_ERROR] Full error:', error);
      const serverMessage = error.responseBody?.error || error.message;
      setFormError(serverMessage || 'Ошибка при сохранении рейса');
    }
  };

  const handleEdit = (slot) => {
    setEditingSlot(slot);
    setFormData({
      trip_date: normalizeDate(slot.trip_date) || defaultTripDate,
      boat_id: slot.boat_id.toString(),
      time: slot.time,
      price_adult: slot.price_adult ? slot.price_adult.toString() : '',
      price_teen: slot.price_teen ? slot.price_teen.toString() : '',
      price_child: slot.price_child ? slot.price_child.toString() : '',
      capacity: slot.capacity.toString(),
      duration_minutes: slot.duration_minutes ? slot.duration_minutes.toString() : '',
      active: slot.is_active
    });
    setShowForm(true);
  };

  const handleCancelTrip = async (slot) => {
    // Show confirmation dialog instead of immediate cancellation
    setSlotToCancel(slot);
    setShowConfirmDialog(true);
  };
  
  const confirmCancelTrip = async () => {
    if (!slotToCancel) return;
    
    setFormError('');
    setSuccessMessage('');
    setShowConfirmDialog(false);
    
    try {
      const updatedSlot = await apiClient.deactivateDispatcherSlot(slotToCancel.id, { active: 0 });
      console.log('[UI_TRIP_CANCEL] success slotId=', slotToCancel.id);
      setSlots(prev => prev.map(s => s.id === slotToCancel.id ? updatedSlot : s));
      setSuccessMessage('Рейс отменен');
      onTripCancelled?.();
      

    } catch (error) {
      console.error('[CANCEL_SLOT_ERROR] Full error:', error);
      const serverMessage = error.responseBody?.error || error.message;
      setFormError(serverMessage || 'Ошибка при отмене рейса');
    }
    
    setSlotToCancel(null);
  };
  
  const cancelCancelTrip = () => {
    setShowConfirmDialog(false);
    setSlotToCancel(null);
  };
  
  const handleDelete = (slot) => {
    setSlotToDelete(slot);
    setShowDeleteDialog(true);
  };
  
  const confirmDeleteSlot = async () => {
    if (!slotToDelete) return;
    
    setFormError('');
    setSuccessMessage('');
    setShowDeleteDialog(false);
    
    try {
      const response = await apiClient.deleteDispatcherSlot(slotToDelete.id);
      
      // Handle the response based on the new format
      if (response.mode === 'archived') {
        // Slot was archived instead of deleted, update the local state
        setSlots(prev => prev.map(s => s.id === slotToDelete.id ? response.slot : s));
        setSuccessMessage(response.message);
      } else if (response.mode === 'deleted') {
        // Slot was actually deleted
        setSlots(prev => prev.filter(s => s.id !== slotToDelete.id));
        setSuccessMessage(response.message);
      } else {
        // Fallback for backward compatibility
        setSlots(prev => prev.filter(s => s.id !== slotToDelete.id));
        setSuccessMessage('Рейс удалён');
      }
    } catch (error) {
      console.error('[DELETE_SLOT_ERROR] Full error:', error);
      const serverMessage = error.responseBody?.error || error.message;
      setFormError(serverMessage || 'Ошибка при удалении рейса');
    }
    
    setSlotToDelete(null);
  };
  
  const cancelDeleteSlot = () => {
    setShowDeleteDialog(false);
    setSlotToDelete(null);
  };

  const handleActivate = async (slot) => {
    setFormError('');
    setSuccessMessage('');
    
    try {
      const updatedSlot = await apiClient.deactivateDispatcherSlot(slot.id, { active: 1 });
      setSlots(prev => prev.map(s => s.id === slot.id ? updatedSlot : s));
      setSuccessMessage('Рейс открыт');
      onTripCancelled?.();
      

    } catch (error) {
      console.error('[ACTIVATE_SLOT_ERROR] Full error:', error);
      const serverMessage = error.responseBody?.error || error.message;
      setFormError(serverMessage || 'Ошибка при открытии рейса');
    }
  };

  const handleCreateNew = () => {
    setEditingSlot(null);
    setFormData({ trip_date: defaultTripDate, boat_id: '', time: '', price_adult: '', price_teen: '', price_child: '', capacity: '', duration_minutes: '', active: 1 });
    setShowForm(true);
  };


  const resetForm = () => {
    setShowForm(false);
    setEditingSlot(null);
    setFormData({ trip_date: defaultTripDate, boat_id: '', time: '', price_adult: '', price_teen: '', price_child: '', capacity: '', duration_minutes: '', active: 1 });
    setFormError('');
  };

  const handleRemoveTripsForDeletedBoats = async () => {
    if (!window.confirm('Вы уверены, что хотите удалить все рейсы для удалённых лодок? Это действие нельзя отменить.')) {
      return;
    }
    
    setFormError('');
    setSuccessMessage('');
    
    try {
      const response = await apiClient.removeTripsForDeletedBoats();
      setSuccessMessage(response.message || 'Рейсы для удалённых лодок удалены');
      // Refresh the list
      loadSlotsAndBoats();
    } catch (error) {
      console.error('[REMOVE_DELETED_BOATS_TRIPS_ERROR] Full error:', error);
      const serverMessage = error.responseBody?.error || error.message;
      setFormError(serverMessage || 'Ошибка при удалении рейсов для удалённых лодок');
    }
  };
  
  const handleScheduleGenerationComplete = () => {
    // Refresh the slot list when schedule generation is complete
    loadSlotsAndBoats();
    
    // Also notify parent that all slots should be refreshed
    if (typeof onTripCancelled === 'function') {
      onTripCancelled();
    }
  };

  const formPanelClass = 'dp-panel mb-6';
  const formTitleClass = 'dp-section-title mb-4';
  const fieldLabelClass = 'mb-1 block text-sm font-medium text-neutral-200';
  const miniLabelClass = 'mb-1 block text-xs text-neutral-400';
  const fieldClass =
    'w-full px-4 py-3 text-sm';
  const readOnlyFieldClass = 'rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-neutral-100';
  const checkboxClass =
    'h-4 w-4 rounded border-white/10 bg-[#07101d] text-blue-500 focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-0';
  


  return (
    <>
      {/* Tab Navigation */}
      <div className="mb-4">
        <nav className="dp-segmented">
          <button
            onClick={() => setActiveTab('slots')}
            className={dpButton({
              variant: activeTab === 'slots' ? 'primary' : 'ghost',
              active: activeTab === 'slots',
              size: 'sm',
            })}
          >
            Рейсы (даты)
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={dpButton({
              variant: activeTab === 'schedule' ? 'primary' : 'ghost',
              active: activeTab === 'schedule',
              size: 'sm',
            })}
          >
            Расписание (шаблоны)
          </button>

        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'slots' && (
        <div className="mt-6">
          {formError && (
            <div className={dpAlert('danger', 'mb-4')}>
              {formError}
            </div>
          )}

          {successMessage && (
            <div className={dpAlert('success', 'mb-4')}>
              {successMessage}
            </div>
          )}
          

          {showForm && (
              <div className={formPanelClass}>
              <h4 className={formTitleClass}>
                {editingSlot ? 'Редактировать рейс' : 'Создать новый рейс'}
              </h4>
              
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {editingSlot ? (
                    <>
                      <div>
                        <label className={fieldLabelClass}>
                          Дата рейса
                        </label>
                        <div className={readOnlyFieldClass}>
                          {formData.trip_date || 'Дата не указана'}
                        </div>
                      </div>

                      {/* Show boat as read-only when editing */}
                      <div>
                        <label className={fieldLabelClass}>
                          Лодка
                        </label>
                        <div className={readOnlyFieldClass}>
                          {boats.find(b => b.id === parseInt(formData.boat_id))?.name || 'Неизвестная лодка'}
                        </div>
                      </div>
                      
                      <TimeFieldPicker
                        name="time"
                        label="Время (ЧЧ:ММ)"
                        value={formData.time}
                        onChange={(nextValue) => setFormData(prev => ({ ...prev, time: nextValue }))}
                        options={timeOptions}
                        className="relative"
                        triggerClassName={fieldClass}
                        required
                        sheetTitle="Выберите время рейса"
                        sheetDescription="Доступные слоты: 08:00 - 21:00 с шагом 30 минут."
                      />
                      
                      <div>
                        <label className={fieldLabelClass}>
                          Вместимость
                        </label>
                        <input
                          type="number"
                          name="capacity"
                          value={formData.capacity}
                          onChange={handleInputChange}
                          min="1"
                          className={fieldClass}
                          required
                        />
                      </div>
                      
                      <div className="col-span-full">
                        <label className={fieldLabelClass}>
                          Цены по категориям
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-neutral-400 mb-1">Взрослый</label>
                            <input
                              type="number"
                              value={formData.price_adult}
                              onChange={(e) => handlePriceChange('adult', e.target.value)}
                              min="0"
                              step="0.01"
                              className={fieldClass}
                              required
                            />
                          </div>
                          {boats.find(b => b.id === parseInt(formData.boat_id))?.type !== 'banana' && (
                            <div>
                              <label className="block text-xs text-neutral-400 mb-1">Подросток</label>
                              <input
                                type="number"
                                value={formData.price_teen}
                                onChange={(e) => handlePriceChange('teen', e.target.value)}
                                min="0"
                                step="0.01"
                                className={fieldClass}
                                required
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-neutral-400 mb-1">Ребёнок</label>
                            <input
                              type="number"
                              value={formData.price_child}
                              onChange={(e) => handlePriceChange('child', e.target.value)}
                              min="0"
                              step="0.01"
                              className={fieldClass}
                              required
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <label className={fieldLabelClass}>
                          Длительность (мин)
                        </label>
                        <select
                          name="duration_minutes"
                          value={formData.duration_minutes}
                          onChange={handleInputChange}
                          className={fieldClass}
                          required
                        >
                          <option value="">Выберите длительность</option>
                          {boats.find(b => b.id === parseInt(formData.boat_id))?.type === 'banana' ? (
                            <option value="40">40 минут (банан)</option>
                          ) : (
                            <>
                              <option value="60">60 минут (1ч)</option>
                              <option value="120">120 минут (2ч)</option>
                              <option value="180">180 минут (3ч)</option>
                            </>
                          )}
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <DateFieldPicker
                        label="Дата рейса"
                        value={formData.trip_date}
                        onChange={handleTripDateChange}
                        tone="dark"
                        size="md"
                        inputName="trip_date"
                        triggerClassName={fieldClass}
                        labelClassName="normal-case tracking-normal text-sm font-medium text-neutral-200"
                        sheetTitle="Выберите дату рейса"
                        sheetDescription="Рейс будет создан и показан в списке на выбранную дату."
                        required
                      />

                      <div>
                        <label className={fieldLabelClass}>
                          Лодка
                        </label>
                        <select
                          name="boat_id"
                          value={formData.boat_id}
                          onChange={handleInputChange}
                          className={fieldClass}
                          required
                        >
                          <option value="">Выберите лодку</option>
                          {boats.map(boat => (
                            <option key={boat.id} value={boat.id}>
                              {boat.name} ({boat.type === 'speed' ? 'Скоростная' : 'Прогулочная'})
                            </option>
                          ))}
                        </select>
                      </div>
                      
                      <TimeFieldPicker
                        name="time"
                        label="Время (ЧЧ:ММ)"
                        value={formData.time}
                        onChange={(nextValue) => setFormData(prev => ({ ...prev, time: nextValue }))}
                        options={timeOptions}
                        className="relative"
                        triggerClassName={fieldClass}
                        required
                        sheetTitle="Выберите время рейса"
                        sheetDescription="Доступные слоты: 08:00 - 21:00 с шагом 30 минут."
                      />
                      
                      <div>
                        <label className={fieldLabelClass}>
                          Вместимость
                        </label>
                        <input
                          type="number"
                          name="capacity"
                          value={formData.capacity}
                          onChange={handleInputChange}
                          min="1"
                          className={fieldClass}
                          required
                        />
                      </div>
                      
                      <div className="col-span-full">
                        <label className={fieldLabelClass}>
                          Цены по категориям
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-neutral-400 mb-1">Взрослый</label>
                            <input
                              type="number"
                              value={formData.price_adult}
                              onChange={(e) => handlePriceChange('adult', e.target.value)}
                              min="0"
                              step="0.01"
                              className={fieldClass}
                              required
                            />
                          </div>
                          {boats.find(b => b.id === parseInt(formData.boat_id))?.type !== 'banana' && (
                            <div>
                              <label className="block text-xs text-neutral-400 mb-1">Подросток</label>
                              <input
                                type="number"
                                value={formData.price_teen}
                                onChange={(e) => handlePriceChange('teen', e.target.value)}
                                min="0"
                                step="0.01"
                                className={fieldClass}
                                required
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-neutral-400 mb-1">Ребёнок</label>
                            <input
                              type="number"
                              value={formData.price_child}
                              onChange={(e) => handlePriceChange('child', e.target.value)}
                              min="0"
                              step="0.01"
                              className={fieldClass}
                              required
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <label className={fieldLabelClass}>
                          Длительность (мин)
                        </label>
                        <select
                          name="duration_minutes"
                          value={formData.duration_minutes}
                          onChange={handleInputChange}
                          className={fieldClass}
                          required
                        >
                          <option value="">Выберите длительность</option>
                          {boats.find(b => b.id === parseInt(formData.boat_id))?.type === 'banana' ? (
                            <option value="40">40 минут (банан)</option>
                          ) : (
                            <>
                              <option value="60">60 минут (1ч)</option>
                              <option value="120">120 минут (2ч)</option>
                              <option value="180">180 минут (3ч)</option>
                            </>
                          )}
                        </select>
                      </div>
                    </>
                  )}
                </div>
                
                {editingSlot ? null : (
                  <div className="flex items-center mb-4">
                    <input
                      type="checkbox"
                      name="active"
                      id="active"
                      checked={formData.active}
                      onChange={(e) => setFormData(prev => ({ ...prev, active: e.target.checked ? 1 : 0 }))}
                      className={checkboxClass}
                    />
                    <label htmlFor="active" className="ml-2 block text-sm text-neutral-200">
                      Активный
                    </label>
                  </div>
                )}
                
                <div className="flex space-x-3">
                  <button
                    type="submit"
                    className={dpButton({ variant: 'primary' })}
                  >
                    {editingSlot ? 'Сохранить' : 'Создать'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className={dpButton({ variant: 'ghost' })}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-center py-4">Загрузка...</div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-medium text-neutral-200">Все рейсы</h4>
                <div className="flex space-x-2">
                  <button
                    onClick={handleCreateNew}
                    disabled={shiftClosed}
                    title={shiftClosed ? 'Смена закрыта — действия запрещены' : ''}
                    className={dpButton({
                      variant: shiftClosed ? 'ghost' : 'primary',
                      disabled: shiftClosed,
                    })}
                  >
                    Создать рейс
                  </button>
                  {(currentUser?.role === 'admin' || currentUser?.role === 'owner') && (
                  <button
                    onClick={handleRemoveTripsForDeletedBoats}
                    disabled={shiftClosed}
                    title={shiftClosed ? 'Смена закрыта — действия запрещены' : 'Удалить все рейсы для удалённых лодок'}
                    className={dpButton({
                      variant: shiftClosed ? 'ghost' : 'danger',
                      disabled: shiftClosed,
                    })}
                  >
                    Удалить рейсы для удалённых лодок
                  </button>
                )}
                </div>
              </div>
              {filteredSlots.map(slot => {
                const capacityRaw = (slot?.capacity ?? slot?.boat_capacity ?? slot?.boatCapacity);
                const capacity = (typeof capacityRaw === 'number' && Number.isFinite(capacityRaw)) ? capacityRaw : null;

                const seatsLeftRaw = (slot?.seats_left ?? slot?.seatsLeft ?? slot?.seats_available ?? slot?.seatsAvailable ?? slot?.seats_remaining ?? slot?.seatsRemaining);
                const seatsLeftFromSold = (capacity !== null && typeof slot?.sold_seats_from_presales === 'number') ? Math.max(0, capacity - slot.sold_seats_from_presales) : null;
                const seatsLeft = (typeof seatsLeftRaw === 'number' && Number.isFinite(seatsLeftRaw)) ? seatsLeftRaw : seatsLeftFromSold;
                const occupiedSeats = (capacity !== null && seatsLeft !== null) ? Math.max(0, capacity - seatsLeft) : null;

                const durationMinRaw = (slot?.duration_minutes ?? slot?.durationMinutes ?? slot?.duration);
                const durationMin = (typeof durationMinRaw === 'number' && Number.isFinite(durationMinRaw)) ? durationMinRaw : null;
                const durationText = durationMin ? formatDurationMinutes(durationMin) : '~1 час';

                return (
                <div key={slot.slot_uid} className="dp-card dp-card--interactive flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="font-bold">{slot.boat_name}</div>
                    <div className="text-sm text-neutral-400">
                      {slot.trip_date ? `${slot.trip_date} • ` : ''}{slot.time} • Длительность: {durationText}
                    </div>
                    <div className="text-sm text-neutral-400">
                      Свободно: <span className="font-bold text-neutral-100">{seatsLeft ?? '—'}</span> • Занято: <span className="font-bold text-neutral-100">{occupiedSeats ?? '—'}</span>{capacity !== null ? ` / ${capacity}` : ''} • {slot.boat_type === 'speed' ? 'Скоростная' : (slot.boat_type === 'banana' ? 'Банан' : 'Прогулочная')}
                    </div>
                    <div className="text-xs text-gray-500">
                      ID: {slot.id} • {slot.is_active ? 'Активный' : 'Неактивный'} • {slot.source_type === 'generated' ? 'Сгенерированный' : 'Ручной'}
                    </div>
                    {!slot.boat_is_active && !slot.boat_missing && (
                      <div className="mt-2 text-xs font-medium text-amber-300">
                        ⚠️ Недоступен для продажи (лодка неактивна)
                      </div>
                    )}
                    {slot.boat_missing && (
                      <div className="mt-2 text-xs font-medium text-rose-300">
                        ⚠️ Недоступен для продажи (лодка удалена)
                      </div>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    {slot.source_type === 'generated' ? (
                      <button
                        disabled
                        title="Редактирование сгенерированных рейсов недоступно. Измените шаблон."
                        className={dpButton({ variant: 'ghost', disabled: true, size: 'sm' })}
                      >
                        Редактировать
                      </button>
                    ) : (
                      <button
                        onClick={() => handleEdit(slot)}
                        disabled={!slot.boat_is_active || slot.boat_missing || shiftClosed}
                        title={shiftClosed ? 'Смена закрыта — действия запрещены' : !slot.boat_is_active && !slot.boat_missing ? 'Редактирование недоступно: лодка неактивна' : slot.boat_missing ? 'Редактирование недоступно: лодка удалена' : ''}
                        className={dpButton({
                          variant: shiftClosed || !slot.boat_is_active || slot.boat_missing ? 'ghost' : 'secondary',
                          disabled: shiftClosed || !slot.boat_is_active || slot.boat_missing,
                          size: 'sm',
                        })}
                      >
                        Редактировать
                      </button>
                    )}
                    {slot.is_active ? (
                      <button
                        onClick={() => handleCancelTrip(slot)}
                        disabled={!slot.boat_is_active || slot.boat_missing || shiftClosed}
                        title={shiftClosed ? 'Смена закрыта — действия запрещены' : !slot.boat_is_active && !slot.boat_missing ? 'Отмена недоступна: лодка неактивна' : slot.boat_missing ? 'Отмена недоступна: лодка удалена' : ''}
                        className={dpButton({
                          variant: shiftClosed || !slot.boat_is_active || slot.boat_missing ? 'ghost' : 'warning',
                          disabled: shiftClosed || !slot.boat_is_active || slot.boat_missing,
                          size: 'sm',
                        })}
                      >
                        Отменить рейс
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivate(slot)}
                        disabled={!slot.boat_is_active || slot.boat_missing || shiftClosed}
                        title={shiftClosed ? 'Смена закрыта — действия запрещены' : !slot.boat_is_active && !slot.boat_missing ? 'Активация недоступна: лодка неактивна' : slot.boat_missing ? 'Активация недоступна: лодка удалена' : ''}
                        className={dpButton({
                          variant: shiftClosed || !slot.boat_is_active || slot.boat_missing ? 'ghost' : 'success',
                          disabled: shiftClosed || !slot.boat_is_active || slot.boat_missing,
                          size: 'sm',
                        })}
                      >
                        Активировать
                      </button>
                    )}
                    {slot.source_type === 'generated' ? (
                      <button
                        disabled
                        title="Удаление сгенерированных рейсов недоступно. Удалите шаблон."
                        className={dpButton({ variant: 'ghost', disabled: true, size: 'sm' })}
                      >
                        Удалить
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(slot)}
                        disabled={shiftClosed}
                        title={shiftClosed ? 'Смена закрыта — действия запрещены' : ''}
                        className={dpButton({
                          variant: shiftClosed ? 'ghost' : 'danger',
                          disabled: shiftClosed,
                          size: 'sm',
                        })}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
              
              {filteredSlots.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Нет рейсов
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="mt-6">
          <ScheduleTemplates onGenerationComplete={handleScheduleGenerationComplete} />
        </div>
      )}

      <ConfirmCancelTripModal
        open={showConfirmDialog}
        onClose={cancelCancelTrip}
        onConfirm={confirmCancelTrip}
      />
      
      {/* Delete confirmation modal */}
      <div className={`dp-overlay z-50 ${showDeleteDialog ? 'block' : 'hidden'}`}>
        <div className="flex min-h-screen items-center justify-center p-3">
          <div className="dp-modal-card">
          <h3 className="text-lg font-bold text-neutral-100 mb-2">Подтверждение удаления</h3>
          <p className="text-neutral-400 mb-6">
            Вы уверены, что хотите удалить рейс <span className="font-semibold">{slotToDelete?.boat_name} в {slotToDelete?.time}</span>?<br />
            Это действие нельзя отменить.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={cancelDeleteSlot}
              className={dpButton({ variant: 'ghost' })}
            >
              Отмена
            </button>
            <button
              onClick={confirmDeleteSlot}
              className={dpButton({ variant: 'danger' })}
            >
              Удалить
            </button>
          </div>
          </div>
        </div>
      </div>
      
    </>
  );
};

export default SlotManagement;
