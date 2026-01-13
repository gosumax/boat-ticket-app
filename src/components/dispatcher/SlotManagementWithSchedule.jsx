import { useState, useEffect, useMemo } from 'react';
import apiClient from '../../utils/apiClient';
import ConfirmCancelTripModal from './ConfirmCancelTripModal';
import ScheduleTemplates from './ScheduleTemplates';

const SlotManagementWithSchedule = ({ onTripCancelled, dateFilter, typeFilter, statusFilter, searchTerm }) => {
  const [slots, setSlots] = useState([]);
  const [boats, setBoats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('slots'); // 'slots' for date-based trips, 'templates' for schedule templates

  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [showingTemplates, setShowingTemplates] = useState(false); // Whether to show templates list instead of slots list
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Trip form state
  const [formData, setFormData] = useState({
    boat_id: '',
    time: '',
    price_adult: '',
    price_teen: '',
    price_child: '',
    capacity: '',
    duration_minutes: '',
    active: 1
  });
  
  // Template form state
  const [templateFormData, setTemplateFormData] = useState({
    product_type: 'speed',
    time: '',
    duration_minutes: '60',
    capacity: '',
    price_adult: '',
    price_child: '',
    price_teen: '',
    is_active: 1
  });
  
  // Generate time options from 08:00 to 21:00 in 30-minute intervals
  const timeOptions = useMemo(() => {
    const options = [];
    for (let hour = 8; hour <= 21; hour++) {
      options.push(`${hour.toString().padStart(2, '0')}:00`);
      if (hour < 21) { // Don't add 21:30 since we want to stop at 21:00
        options.push(`${hour.toString().padStart(2, '0')}:30`);
      }
    }
    return options;
  }, []);
  
  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [slotToCancel, setSlotToCancel] = useState(null);
  
  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [slotToDelete, setSlotToDelete] = useState(null);
  
  // State for time tooltip visibility
  const [showTimeTooltip, setShowTimeTooltip] = useState(false);
  
  // Filter slots based on props from parent
  const filteredSlots = useMemo(() => {
    let result = slots;
    
    // Date filter - no date fields in slot data, so ignore for now
    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter(slot => {
        const boatType = slot.boat_type || '';
        return boatType === typeFilter;
      });
    }
    
    // Status filter - map based on is_active field
    if (statusFilter !== 'all') {
      result = result.filter(slot => {
        const isActive = slot.is_active;
        
        if (statusFilter === 'active') {
          return isActive;
        } else if (statusFilter === 'cancelled') {
          return !isActive;
        } else if (statusFilter === 'completed') {
          // Assuming completed is not applicable for slots
          return false;
        }
        return true;
      });
    }
    
    // Search filter - search across relevant fields
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(slot => {
        const boatName = slot.boat_name || '';
        const boatType = slot.boat_type || '';
        const idStr = slot.id.toString();
        
        return (
          boatName.toLowerCase().includes(term) ||
          boatType.toLowerCase().includes(term) ||
          idStr.includes(term) ||
          slot.time.includes(term)
        );
      });
    }
    
    return result;
  }, [slots, dateFilter, typeFilter, statusFilter, searchTerm]);

  // Load slots, boats, and templates
  useEffect(() => {
    loadSlotsBoatsAndTemplates();
  }, []);

  const loadSlotsBoatsAndTemplates = async () => {
    setLoading(true);
    try {
      const [slotsData, boatsData, templatesData] = await Promise.all([
        apiClient.getAllDispatcherSlots(),
        apiClient.getAllDispatcherBoats(),
        apiClient.getScheduleTemplates()
      ]);
      setSlots(slotsData);
      setBoats(boatsData);
      setTemplates(templatesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await apiClient.getScheduleTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
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
      if (!formData.boat_id || !formData.time || !formData.capacity || !formData.duration_minutes) {
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
        setSuccessMessage('Рейс обновлён');
      } else {
        // Create new slot
        const createPayload = {
          ...payload,
          boat_id: parseInt(formData.boat_id),
          active: parseInt(formData.active)
        };
        
        const newSlot = await apiClient.createDispatcherSlot(createPayload);
        setSlots(prev => [...prev, newSlot]);
        setSuccessMessage('Рейс создан');
      }
      
      // Reset form
      setFormData({ boat_id: '', time: '', price_adult: '', price_teen: '', price_child: '', capacity: '', active: 1 });
      setShowForm(false);
      setEditingSlot(null);
      
      // Refresh the list
      loadSlotsBoatsAndTemplates();
    } catch (error) {
      console.error('[CREATE_SLOT_ERROR] Full error:', error);
      const serverMessage = error.responseBody?.error || error.message;
      setFormError(serverMessage || 'Ошибка при сохранении рейса');
    }
  };

  const handleEdit = (slot) => {
    setEditingSlot(slot);
    setFormData({
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
      await apiClient.deleteDispatcherSlot(slotToDelete.id);
      setSlots(prev => prev.filter(s => s.id !== slotToDelete.id));
      setSuccessMessage('Рейс удалён');
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
    setFormData({ boat_id: '', time: '', price_adult: '', price_teen: '', price_child: '', capacity: '', active: 1 });
    setShowForm(true);
  };

  const handleCreateNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateFormData({
      product_type: 'speed',
      time: '',
      duration_minutes: '60',
      capacity: '',
      price_adult: '',
      price_child: '',
      price_teen: '',
      is_active: 1
    });
    setShowTemplateForm(true);
  };

  const handleTemplateInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setTemplateFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (checked ? 1 : 0) : value
    }));
  };

  // Handle price changes for specific ticket types in template form
  const handleTemplatePriceChange = (type, value) => {
    setTemplateFormData(prev => ({
      ...prev,
      [`price_${type}`]: value
    }));
  };

  const handleTemplateSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');

    // Validate form data
    if (!templateFormData.product_type || !templateFormData.time || !templateFormData.capacity) {
      setFormError('Все поля обязательны для заполнения');
      return;
    }

    // Validate prices
    const priceAdult = parseInt(templateFormData.price_adult) || 0;
    const priceChild = parseInt(templateFormData.price_child) || 0;
    const priceTeen = parseInt(templateFormData.price_teen) || 0;

    if (priceAdult <= 0) {
      setFormError('Некорректная цена для взрослых');
      return;
    }
    if (priceChild <= 0) {
      setFormError('Некорректная цена для детей');
      return;
    }

    // For banana, teen price should not be provided
    if (templateFormData.product_type === 'banana' && priceTeen > 0) {
      setFormError('Для банана подростковый билет запрещён');
      return;
    }

    // For banana, capacity must be 12
    if (templateFormData.product_type === 'banana' && parseInt(templateFormData.capacity) !== 12) {
      setFormError('Для банана вместимость должна быть 12 мест');
      return;
    }

    // Validate duration based on product type
    if (templateFormData.product_type === 'banana' && parseInt(templateFormData.duration_minutes) !== 40) {
      setFormError('Для банана длительность должна быть 40 минут');
      return;
    }

    if (templateFormData.product_type !== 'banana' && ![60, 120, 180].includes(parseInt(templateFormData.duration_minutes))) {
      setFormError('Для лодок длительность должна быть 60, 120 или 180 минут');
      return;
    }

    try {
      const payload = {
        product_type: templateFormData.product_type,
        time: templateFormData.time,
        duration_minutes: parseInt(templateFormData.duration_minutes),
        capacity: parseInt(templateFormData.capacity),
        price_adult: priceAdult,
        price_child: priceChild,
        ...(templateFormData.product_type !== 'banana' && templateFormData.price_teen ? { price_teen: priceTeen } : {}),
        is_active: parseInt(templateFormData.is_active)
      };

      if (editingTemplate) {
        // Update existing template
        const updatedTemplate = await apiClient.updateTripTemplate(editingTemplate.id, payload);
        setTemplates(prev => prev.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
        setSuccessMessage('Шаблон обновлён');
      } else {
        // Create new template
        const newTemplate = await apiClient.createTripTemplate(payload);
        setTemplates(prev => [...prev, newTemplate]);
        setSuccessMessage('Шаблон создан');
      }

      // Reset form
      resetTemplateForm();
    } catch (error) {
      console.error('Error saving template:', error);
      const errorMessage = error.responseBody?.error || error.message;
      setFormError(errorMessage || 'Ошибка при сохранении шаблона');
    }
  };

  const resetTemplateForm = () => {
    setShowTemplateForm(false);
    setEditingTemplate(null);
    setTemplateFormData({
      product_type: 'speed',
      time: '',
      duration_minutes: '60',
      capacity: '',
      price_adult: '',
      price_child: '',
      price_teen: '',
      is_active: 1
    });
  };

  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
    setTemplateFormData({
      product_type: template.product_type,
      time: template.time,
      duration_minutes: template.duration_minutes?.toString() || '60',
      capacity: template.capacity?.toString() || '',
      price_adult: template.price_adult?.toString() || '',
      price_child: template.price_child?.toString() || '',
      price_teen: template.price_teen?.toString() || '',
      is_active: template.is_active
    });
    setShowTemplateForm(true);
  };

  const handleDeleteTemplate = async (templateId) => {
    if (!window.confirm('Вы уверены, что хотите удалить этот шаблон?')) {
      return;
    }

    try {
      await apiClient.deleteTripTemplate(templateId);
      setTemplates(prev => prev.filter(t => t.id !== templateId));
      setSuccessMessage('Шаблон удалён');
    } catch (error) {
      console.error('Error deleting template:', error);
      setFormError('Ошибка при удалении шаблона');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingSlot(null);
    setFormData({ boat_id: '', time: '', price_adult: '', price_teen: '', price_child: '', capacity: '', duration_minutes: '', active: 1 });
    setFormError('');
  };

  return (
    <>
      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('slots')}
            className={`px-6 py-3 font-medium text-sm ${
              activeTab === 'slots'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Рейсы (даты)
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-6 py-3 font-medium text-sm ${
              activeTab === 'templates'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Расписание (шаблоны)
          </button>
        </div>
      </div>

      <div className="mt-6">
        {formError && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
            {formError}
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-lg">
            {successMessage}
          </div>
        )}
        
        {/* Slots Tab - Date-based trips */}
        {activeTab === 'slots' && (
          <>
            {showForm && (
              <div className="mb-6 bg-white rounded-xl shadow-md p-6">
                <h4 className="text-lg font-bold mb-4">
                  {editingSlot ? 'Редактировать рейс' : 'Создать новый рейс'}
                </h4>
                
                <form onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {editingSlot ? (
                      <>
                        {/* Show boat as read-only when editing */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Лодка
                          </label>
                          <div className="p-2 border border-gray-300 rounded-lg bg-gray-50">
                            {boats.find(b => b.id === parseInt(formData.boat_id))?.name || 'Неизвестная лодка'}
                          </div>
                        </div>
                        
                        <div className="relative">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Время (ЧЧ:ММ)
                          </label>
                          <select
                            name="time"
                            value={formData.time}
                            onChange={handleInputChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            required
                            onMouseEnter={() => setShowTimeTooltip(true)}
                            onMouseLeave={() => setShowTimeTooltip(false)}
                            onFocus={() => setShowTimeTooltip(true)}
                            onBlur={() => setShowTimeTooltip(false)}
                          >
                            <option value="">Выберите время</option>
                            {timeOptions.map(time => (
                              <option key={time} value={time}>{time}</option>
                            ))}
                          </select>
                          
                          {/* Time selection tooltip */}
                          {showTimeTooltip && (
                            <div className="absolute z-10 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg p-2 -left-4 top-full">
                              <div className="text-xs font-medium text-gray-700 mb-1">Доступные слоты:</div>
                              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                                {timeOptions.map(time => (
                                  <div key={time} className="text-sm p-1 hover:bg-blue-100 rounded">
                                    {time}
                                  </div>
                                ))}
                              </div>
                              <div className="text-xs text-gray-500 mt-1 px-1">08:00 - 21:00</div>
                            </div>
                          )}
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Вместимость
                          </label>
                          <input
                            type="number"
                            name="capacity"
                            value={formData.capacity}
                            onChange={handleInputChange}
                            min="1"
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            required
                          />
                        </div>
                        
                        <div className="col-span-full">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Цены по категориям
                          </label>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Взрослый</label>
                              <input
                                type="number"
                                value={formData.price_adult}
                                onChange={(e) => handlePriceChange('adult', e.target.value)}
                                min="0"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                                required
                              />
                            </div>
                            {boats.find(b => b.id === parseInt(formData.boat_id))?.type !== 'banana' && (
                              <div>
                                <label className="block text-xs text-gray-600 mb-1">Подросток</label>
                                <input
                                  type="number"
                                  value={formData.price_teen}
                                  onChange={(e) => handlePriceChange('teen', e.target.value)}
                                  min="0"
                                  step="0.01"
                                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                                  required
                                />
                              </div>
                            )}
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Ребёнок</label>
                              <input
                                type="number"
                                value={formData.price_child}
                                onChange={(e) => handlePriceChange('child', e.target.value)}
                                min="0"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                                required
                              />
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Длительность (мин)
                          </label>
                          <select
                            name="duration_minutes"
                            value={formData.duration_minutes}
                            onChange={handleInputChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
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
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Лодка
                          </label>
                          <select
                            name="boat_id"
                            value={formData.boat_id}
                            onChange={handleInputChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
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
                        
                        <div className="relative">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Время (ЧЧ:ММ)
                          </label>
                          <select
                            name="time"
                            value={formData.time}
                            onChange={handleInputChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            required
                            onMouseEnter={() => setShowTimeTooltip(true)}
                            onMouseLeave={() => setShowTimeTooltip(false)}
                            onFocus={() => setShowTimeTooltip(true)}
                            onBlur={() => setShowTimeTooltip(false)}
                          >
                            <option value="">Выберите время</option>
                            {timeOptions.map(time => (
                              <option key={time} value={time}>{time}</option>
                            ))}
                          </select>
                          
                          {/* Time selection tooltip */}
                          {showTimeTooltip && (
                            <div className="absolute z-10 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg p-2 -left-4 top-full">
                              <div className="text-xs font-medium text-gray-700 mb-1">Доступные слоты:</div>
                              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                                {timeOptions.map(time => (
                                  <div key={time} className="text-sm p-1 hover:bg-blue-100 rounded">
                                    {time}
                                  </div>
                                ))}
                              </div>
                              <div className="text-xs text-gray-500 mt-1 px-1">08:00 - 21:00</div>
                            </div>
                          )}
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Вместимость
                          </label>
                          <input
                            type="number"
                            name="capacity"
                            value={formData.capacity}
                            onChange={handleInputChange}
                            min="1"
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            required
                          />
                        </div>
                        
                        <div className="col-span-full">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Цены по категориям
                          </label>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Взрослый</label>
                              <input
                                type="number"
                                value={formData.price_adult}
                                onChange={(e) => handlePriceChange('adult', e.target.value)}
                                min="0"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                                required
                              />
                            </div>
                            {boats.find(b => b.id === parseInt(formData.boat_id))?.type !== 'banana' && (
                              <div>
                                <label className="block text-xs text-gray-600 mb-1">Подросток</label>
                                <input
                                  type="number"
                                  value={formData.price_teen}
                                  onChange={(e) => handlePriceChange('teen', e.target.value)}
                                  min="0"
                                  step="0.01"
                                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                                  required
                                />
                              </div>
                            )}
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Ребёнок</label>
                              <input
                                type="number"
                                value={formData.price_child}
                                onChange={(e) => handlePriceChange('child', e.target.value)}
                                min="0"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                                required
                              />
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Длительность (мин)
                          </label>
                          <select
                            name="duration_minutes"
                            value={formData.duration_minutes}
                            onChange={handleInputChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
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
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                      />
                      <label htmlFor="active" className="ml-2 block text-sm text-gray-700">
                        Активный
                      </label>
                    </div>
                  )}
                  
                  <div className="flex space-x-3">
                    <button
                      type="submit"
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
                    >
                      {editingSlot ? 'Сохранить' : 'Создать'}
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-medium hover:bg-gray-400 active:bg-gray-500 transition-colors"
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
                  <h4 className="font-medium text-gray-700">Все рейсы</h4>
                  <button
                    onClick={handleCreateNew}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
                  >
                    Создать рейс
                  </button>
                </div>
                {filteredSlots.map(slot => (
                  <div key={slot.id} className="bg-white rounded-xl shadow-md p-4 flex justify-between items-center">
                    <div>
                      <div className="font-bold">{slot.boat_name}</div>
                      <div className="text-sm text-gray-600">
                        {slot.time} • {new Intl.NumberFormat('ru-RU').format(slot.price)} ₽ • 
                        Вместимость: {slot.capacity} • {slot.boat_type === 'speed' ? 'Скоростная' : 'Прогулочная'}
                      </div>
                      <div className="text-xs text-gray-500">
                        ID: {slot.id} • {slot.is_active ? 'Активный' : 'Неактивный'}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEdit(slot)}
                        className="bg-blue-100 text-blue-800 px-3 py-1 rounded-lg text-sm font-medium hover:bg-blue-200 active:bg-blue-300 transition-colors"
                      >
                        Редактировать
                      </button>
                      {slot.is_active ? (
                        <button
                          onClick={() => handleCancelTrip(slot)}
                          className="bg-red-100 text-red-800 px-3 py-1 rounded-lg text-sm font-medium hover:bg-red-200 active:bg-red-300 transition-colors"
                        >
                          Отменить рейс
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivate(slot)}
                          className="bg-green-100 text-green-800 px-3 py-1 rounded-lg text-sm font-medium hover:bg-green-200 active:bg-green-300 transition-colors"
                        >
                          Активировать
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(slot)}
                        className="bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-colors"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
                
                {filteredSlots.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    Нет рейсов
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Templates Tab - Schedule templates */}
        {activeTab === 'templates' && (
          <ScheduleTemplates />
        )}
      </div>
      
      <ConfirmCancelTripModal
        open={showConfirmDialog}
        onClose={cancelCancelTrip}
        onConfirm={confirmCancelTrip}
      />
      
      {/* Delete confirmation modal */}
      <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 ${showDeleteDialog ? 'block' : 'hidden'}`}>
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-2">Подтверждение удаления</h3>
          <p className="text-gray-600 mb-6">
            Вы уверены, что хотите удалить рейс <span className="font-semibold">{slotToDelete?.boat_name} в {slotToDelete?.time}</span>?<br />
            Это действие нельзя отменить.
          </p>
          <div className="flex justify-end space-x-3">
            <button
              onClick={cancelDeleteSlot}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-medium hover:bg-gray-400 active:bg-gray-500 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={confirmDeleteSlot}
              className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 active:bg-red-800 transition-colors"
            >
              Удалить
            </button>
          </div>
        </div>
      </div>
      
    </>
  );
};

export default SlotManagementWithSchedule;