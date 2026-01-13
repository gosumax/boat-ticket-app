import { useState, useEffect, useRef } from 'react';
import apiClient from '../../utils/apiClient';

const ScheduleTemplates = ({ onGenerationComplete }) => {
  const [items, setItems] = useState([]);
  const [boats, setBoats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [generationForm, setGenerationForm] = useState({ date_from: '', date_to: '' });
  const [showGenerationForm, setShowGenerationForm] = useState(false);

  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form state for schedule template items
  const [itemFormData, setItemFormData] = useState({
    name: '',
    boat_id: '',
    type: 'speed',
    departure_time: '',
    duration_minutes: '',
    capacity: '',
    price_adult: '',
    price_child: '',
    price_teen: '',
    weekdays_mask: 0, // bitmask for weekdays
    is_active: 1
  });
  
  // Track which fields have been manually changed by the user
  const [touchedFields, setTouchedFields] = useState({
    capacity: false,
    duration_minutes: false,
    price_adult: false,
    price_teen: false,
    price_child: false
  });
  
  // Ref to track whether defaults have been set for a new template
  const defaultsAppliedRef = useRef(false);

  // Load items and boats
  useEffect(() => {
    loadItemsAndBoats();
  }, []);

  const loadItemsAndBoats = async () => {
    setLoading(true);
    try {
      const [itemsData, boatsData] = await Promise.all([
        apiClient.getScheduleTemplateItems(),
        apiClient.getAllDispatcherBoats()
      ]);
      setItems(itemsData);
      setBoats(boatsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    // Track when capacity or duration is manually changed
    if (name === 'capacity' || name === 'duration_minutes') {
      setTouchedFields(prevTouched => ({
        ...prevTouched,
        [name]: true
      }));
    }
    
    setItemFormData(prev => {
      let updatedData = {
        ...prev,
        [name]: type === 'checkbox' ? (checked ? 1 : 0) : value
      };
      
      // Set defaults for speed boats when type changes (only if field is not touched or empty)
      if (name === 'type') {
        if (value === 'speed') {
          // Set capacity default if not touched and empty
          if (!touchedFields.capacity && !updatedData.capacity) {
            updatedData.capacity = '12';
          }
          // Set duration default if not touched and empty
          if (!touchedFields.duration_minutes && !updatedData.duration_minutes) {
            updatedData.duration_minutes = '120';
          }
          // Set price defaults if not touched and empty
          if (!touchedFields.price_adult && !updatedData.price_adult) {
            updatedData.price_adult = '3000';
          }
          if (!touchedFields.price_teen && !updatedData.price_teen) {
            updatedData.price_teen = '2000';
          }
          if (!touchedFields.price_child && !updatedData.price_child) {
            updatedData.price_child = '1000';
          }
        } else {
          // For non-speed boats, clear defaults if they were set by default
          if (!touchedFields.capacity && updatedData.capacity === '12') {
            updatedData.capacity = '';
          }
          if (!touchedFields.duration_minutes && updatedData.duration_minutes === '120') {
            updatedData.duration_minutes = '';
          }
          if (!touchedFields.price_adult && updatedData.price_adult === '3000') {
            updatedData.price_adult = '';
          }
          if (!touchedFields.price_teen && updatedData.price_teen === '2000') {
            updatedData.price_teen = '';
          }
          if (!touchedFields.price_child && updatedData.price_child === '1000') {
            updatedData.price_child = '';
          }
        }
      }
      
      return updatedData;
    });
  };

  // Handle price changes for specific ticket types
  const handlePriceChange = (type, value) => {
    setItemFormData(prev => ({
      ...prev,
      [`price_${type}`]: value
    }));
    
    // Track when price is manually changed
    setTouchedFields(prevTouched => ({
      ...prevTouched,
      [`price_${type}`]: true
    }));
  };

  // Handle weekday checkbox changes
  const handleWeekdayChange = (dayIndex) => {
    setItemFormData(prev => {
      const newMask = prev.weekdays_mask ^ (1 << dayIndex); // Toggle the bit
      return {
        ...prev,
        weekdays_mask: newMask
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');

    // Validate form data
    if (!itemFormData.departure_time || !itemFormData.type || !itemFormData.capacity || itemFormData.weekdays_mask === 0) {
      setFormError('Все поля обязательны для заполнения');
      return;
    }
    
    // If a specific boat is selected, validate that it's active
    if (itemFormData.boat_id) {
      const selectedBoat = boats.find(b => b.id === parseInt(itemFormData.boat_id));
      if (selectedBoat && selectedBoat.is_active !== 1) {
        setFormError('Выбранная лодка неактивна. Выберите активную лодку или оставьте "Любая подходящая лодка"');
        return;
      }
    }

    // Validate prices
    const priceAdult = parseInt(itemFormData.price_adult) || 0;
    const priceChild = parseInt(itemFormData.price_child) || 0;
    const priceTeen = parseInt(itemFormData.price_teen) || 0;

    if (priceAdult <= 0) {
      setFormError('Некорректная цена для взрослых');
      return;
    }
    if (priceChild <= 0) {
      setFormError('Некорректная цена для детей');
      return;
    }

    // For banana, teen price should not be provided
    if (itemFormData.type === 'banana' && priceTeen > 0) {
      setFormError('Для банана подростковый билет запрещён');
      return;
    }

    // For banana, capacity must be 12
    if (itemFormData.type === 'banana' && parseInt(itemFormData.capacity) !== 12) {
      setFormError('Для банана вместимость должна быть 12 мест');
      return;
    }

    // Validate duration based on product type
    if (itemFormData.type === 'banana' && parseInt(itemFormData.duration_minutes) !== 40) {
      setFormError('Для банана длительность должна быть 40 минут');
      return;
    }

    if (itemFormData.type !== 'banana' && ![60, 120, 180].includes(parseInt(itemFormData.duration_minutes))) {
      setFormError('Для лодок длительность должна быть 60, 120 или 180 минут');
      return;
    }

    try {
      const payload = {
        name: itemFormData.name || null,
        boat_id: itemFormData.boat_id ? parseInt(itemFormData.boat_id) : null,
        type: itemFormData.type,
        departure_time: itemFormData.departure_time,
        duration_minutes: parseInt(itemFormData.duration_minutes),
        capacity: parseInt(itemFormData.capacity),
        price_adult: priceAdult,
        price_child: priceChild,
        ...(itemFormData.type !== 'banana' && itemFormData.price_teen ? { price_teen: priceTeen } : {}),
        weekdays_mask: parseInt(itemFormData.weekdays_mask),
        is_active: parseInt(itemFormData.is_active)
      };

      if (editingItem) {
        // Update existing item
        const updatedItem = await apiClient.updateScheduleTemplateItem(editingItem.id, payload);
        setItems(prev => prev.map(t => t.id === updatedItem.id ? updatedItem : t));
        setSuccessMessage('Шаблон обновлён');
      } else {
        // Create new item
        const newItem = await apiClient.createScheduleTemplateItem(payload);
        setItems(prev => [...prev, newItem]);
        setSuccessMessage('Шаблон создан');
      }

      // Reset form
      resetForm();
    } catch (error) {
      console.error('Error saving template item:', error);
      const errorMessage = error.responseBody?.message || error.responseBody?.error || error.message;
      setFormError(errorMessage || 'Ошибка при сохранении шаблона');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
    setItemFormData({
      name: '',
      boat_id: '',
      type: 'speed',
      departure_time: '',
      duration_minutes: '',
      capacity: '',
      price_adult: '',
      price_child: '',
      price_teen: '',
      weekdays_mask: 0,
      is_active: 1
    });
    setTouchedFields({
      capacity: false,
      duration_minutes: false,
      price_adult: false,
      price_teen: false,
      price_child: false
    });
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setItemFormData({
      name: item.name || '',
      boat_id: item.boat_id?.toString() || '',
      type: item.type,
      departure_time: item.departure_time,
      duration_minutes: item.duration_minutes?.toString() || '',
      capacity: item.capacity?.toString() || '',
      price_adult: item.price_adult?.toString() || '',
      price_child: item.price_child?.toString() || '',
      price_teen: item.price_teen?.toString() || '',
      weekdays_mask: item.weekdays_mask,
      is_active: item.is_active
    });
    // Don't reset touched fields when editing an existing template
    // Mark that defaults have NOT been applied since we're editing an existing template
    defaultsAppliedRef.current = false;
    setShowForm(true);
  };

  const handleCreateNewTemplate = () => {
    setEditingItem(null);
    setItemFormData({
      name: '',
      boat_id: '',
      type: 'speed',
      departure_time: '',
      duration_minutes: '120', // Default for speed
      capacity: '12', // Default for speed
      price_adult: '3000', // Default for speed
      price_child: '1000', // Default for speed
      price_teen: '2000', // Default for speed
      weekdays_mask: 0,
      is_active: 1
    });
    // Reset touched fields for new template
    setTouchedFields({
      capacity: false,
      duration_minutes: false,
      price_adult: false,
      price_teen: false,
      price_child: false
    });
    // Mark that defaults have been applied for this new template
    defaultsAppliedRef.current = true;
    setShowForm(true);
  };

  const handleDelete = async (itemId) => {
    const shouldDeleteFutureTrips = window.confirm('Шаблон удалён. Уже созданные рейсы сохранятся.\n\nНажмите OK, чтобы удалить ТОЛЬКО шаблон.\nНажмите Cancel, чтобы также удалить БУДУЩИЕ рейсы, созданные этим шаблоном.');
    
    const deleteFutureTrips = !shouldDeleteFutureTrips; // If user clicked Cancel, we DO delete future trips
    
    try {
      const result = await apiClient.deleteScheduleTemplateItem(itemId, deleteFutureTrips);
      setItems(prev => prev.filter(t => t.id !== itemId));
      
      if (deleteFutureTrips && result.futureTripsDeleted > 0) {
        setSuccessMessage(`Шаблон удалён. Удалено ${result.futureTripsDeleted} будущих рейсов.`);
      } else {
        setSuccessMessage('Шаблон удалён. Уже созданные рейсы сохранены.');
      }
    } catch (error) {
      console.error('Error deleting template item:', error);
      setFormError('Ошибка при удалении шаблона');
    }
  };

  const handleGenerateSlots = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');

    if (!generationForm.date_from || !generationForm.date_to) {
      setFormError('Даты начала и окончания обязательны');
      return;
    }

    try {
      const result = await apiClient.generateSlotsFromTemplateItems(generationForm);
      setSuccessMessage(`Сгенерировано ${result.generated} рейсов, пропущено ${result.skipped} рейсов`);
      setShowGenerationForm(false);
      setGenerationForm({ date_from: '', date_to: '' });
      
      // Trigger refresh of slot lists after successful generation
      if (onGenerationComplete) {
        onGenerationComplete();
      }
    } catch (error) {
      console.error('Error generating slots:', error);
      const errorMessage = error.responseBody?.message || error.responseBody?.error || error.message;
      setFormError(errorMessage || 'Ошибка при генерации рейсов');
    }
  };

  const getDayNamesFromMask = (mask) => {
    const days = [];
    if (mask & 1) days.push('Пн');
    if (mask & 2) days.push('Вт');
    if (mask & 4) days.push('Ср');
    if (mask & 8) days.push('Чт');
    if (mask & 16) days.push('Пт');
    if (mask & 32) days.push('Сб');
    if (mask & 64) days.push('Вс');
    return days.join(', ');
  };

  const getBoatName = (boatId) => {
    const boat = boats.find(b => b.id === boatId);
    return boat ? boat.name : 'Не указана';
  };

  const getBoatTypeLabel = (type) => {
    const types = {
      speed: 'Скоростная',
      cruise: 'Прогулочная',
      banana: 'Банан'
    };
    return types[type] || type;
  };

  return (
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

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold">Шаблоны расписания</h3>
        <div className="space-x-2">
          <button
            onClick={() => setShowGenerationForm(!showGenerationForm)}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 active:bg-purple-800 transition-colors"
          >
            Сгенерировать рейсы
          </button>
          <button
            onClick={handleCreateNewTemplate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Добавить шаблон
          </button>
        </div>
      </div>

      {/* Generation Form */}
      {showGenerationForm && (
        <div className="mb-6 bg-white rounded-xl shadow-md p-6">
          <h4 className="text-lg font-bold mb-4">Генерация рейсов по шаблонам</h4>
          <form onSubmit={handleGenerateSlots}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Дата начала
                </label>
                <input
                  type="date"
                  name="date_from"
                  value={generationForm.date_from}
                  onChange={(e) => setGenerationForm(prev => ({ ...prev, date_from: e.target.value }))}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Дата окончания
                </label>
                <input
                  type="date"
                  name="date_to"
                  value={generationForm.date_to}
                  onChange={(e) => setGenerationForm(prev => ({ ...prev, date_to: e.target.value }))}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 active:bg-purple-800 transition-colors"
              >
                Сгенерировать
              </button>
              <button
                type="button"
                onClick={() => setShowGenerationForm(false)}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-medium hover:bg-gray-400 active:bg-gray-500 transition-colors"
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Template Form */}
      {showForm && (
        <div className="mb-6 bg-white rounded-xl shadow-md p-6">
          <h4 className="text-lg font-bold mb-4">
            {editingItem ? 'Редактировать шаблон' : 'Создать шаблон расписания'}
          </h4>
          
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Название (необязательно)
                </label>
                <input
                  type="text"
                  name="name"
                  value={itemFormData.name}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Время (ЧЧ:ММ)
                </label>
                <input
                  type="time"
                  name="departure_time"
                  value={itemFormData.departure_time}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Тип лодки
                </label>
                <select
                  name="type"
                  value={itemFormData.type}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="speed">Скоростная</option>
                  <option value="cruise">Прогулочная</option>
                  <option value="banana">Банан</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Лодка (необязательно)
                </label>
                <select
                  name="boat_id"
                  value={itemFormData.boat_id}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Любая подходящая лодка</option>
                  {(() => {
                    const filteredBoats = boats.filter(boat => boat.type === itemFormData.type && boat.is_active === 1);
                    if (filteredBoats.length === 0 && itemFormData.type) {
                      return <option value="" disabled>Нет активных лодок этого типа</option>;
                    }
                    return filteredBoats.map(boat => (
                      <option key={boat.id} value={boat.id}>
                        {boat.name}
                      </option>
                    ));
                  })()}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Вместимость
                </label>
                <input
                  type="number"
                  name="capacity"
                  value={itemFormData.capacity}
                  onChange={handleInputChange}
                  min="1"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Длительность (мин)
                </label>
                <input
                  type="number"
                  name="duration_minutes"
                  value={itemFormData.duration_minutes}
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
                      value={itemFormData.price_adult}
                      onChange={(e) => handlePriceChange('adult', e.target.value)}
                      min="0"
                      step="0.01"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                      required
                    />
                  </div>
                  {itemFormData.type !== 'banana' && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Подросток</label>
                      <input
                        type="number"
                        value={itemFormData.price_teen}
                        onChange={(e) => handlePriceChange('teen', e.target.value)}
                        min="0"
                        step="0.01"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Ребёнок</label>
                    <input
                      type="number"
                      value={itemFormData.price_child}
                      onChange={(e) => handlePriceChange('child', e.target.value)}
                      min="0"
                      step="0.01"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                      required
                    />
                  </div>
                </div>
              </div>
              
              <div className="col-span-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Дни недели
                </label>
                <div className="grid grid-cols-7 gap-2">
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => (
                    <label key={index} className="flex items-center space-x-1">
                      <input
                        type="checkbox"
                        checked={(itemFormData.weekdays_mask & (1 << index)) !== 0}
                        onChange={() => handleWeekdayChange(index)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm">{day}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex items-center mb-4">
              <input
                type="checkbox"
                name="is_active"
                id="is_active"
                checked={itemFormData.is_active}
                onChange={(e) => setItemFormData(prev => ({ ...prev, is_active: e.target.checked ? 1 : 0 }))}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-gray-700">
                Активный
              </label>
            </div>
            
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
              >
                {editingItem ? 'Сохранить' : 'Создать'}
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

      {/* Items List */}
      {loading ? (
        <div className="text-center py-4">Загрузка...</div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-xl shadow-md p-4 flex justify-between items-center">
              <div>
                <div className="font-bold">{item.departure_time} • {getBoatTypeLabel(item.type)} • Лодка: {getBoatName(item.boat_id)} • Мест: {item.capacity} • Дни: {item.weekdays_formatted || getDayNamesFromMask(item.weekdays_mask)}</div>
                <div className="text-sm text-gray-600">
                  Взр: {item.price_adult} ₽ • Дет: {item.price_child} ₽
                  {item.price_teen && ` • Подр: ${item.price_teen} ₽`}
                </div>
                <div className="text-xs text-gray-500">
                  ID: {item.id} • {item.is_active ? 'Активный' : 'Неактивный'}
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleEdit(item)}
                  className="bg-blue-100 text-blue-800 px-3 py-1 rounded-lg text-sm font-medium hover:bg-blue-200 active:bg-blue-300 transition-colors"
                >
                  Редактировать
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-colors"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
          
          {items.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Нет шаблонов расписания
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ScheduleTemplates;