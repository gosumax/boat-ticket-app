import { useState, useEffect } from 'react';
import apiClient from '../../utils/apiClient';

const TripTemplates = ({ onBack }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    product_type: 'speed',
    time: '',
    duration_minutes: '60',
    capacity: '',
    price_adult: '',
    price_child: '',
    price_teen: '',
    is_active: 1
  });

  // Load templates
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getTripTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (checked ? 1 : 0) : value
    }));
  };

  // Handle price changes for specific ticket types
  const handlePriceChange = (type, value) => {
    setFormData(prev => ({
      ...prev,
      [`price_${type}`]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMessage('');

    // Validate form data
    if (!formData.product_type || !formData.time || !formData.capacity) {
      setFormError('Все поля обязательны для заполнения');
      return;
    }

    // Validate prices
    const priceAdult = parseInt(formData.price_adult) || 0;
    const priceChild = parseInt(formData.price_child) || 0;
    const priceTeen = parseInt(formData.price_teen) || 0;

    if (priceAdult <= 0) {
      setFormError('Некорректная цена для взрослых');
      return;
    }
    if (priceChild <= 0) {
      setFormError('Некорректная цена для детей');
      return;
    }

    // For banana, teen price should not be provided
    if (formData.product_type === 'banana' && priceTeen > 0) {
      setFormError('Для банана подростковый билет запрещён');
      return;
    }

    // For banana, capacity must be 12
    if (formData.product_type === 'banana' && parseInt(formData.capacity) !== 12) {
      setFormError('Для банана вместимость должна быть 12 мест');
      return;
    }

    // Validate duration based on product type
    if (formData.product_type === 'banana' && parseInt(formData.duration_minutes) !== 40) {
      setFormError('Для банана длительность должна быть 40 минут');
      return;
    }

    if (formData.product_type !== 'banana' && ![60, 120, 180].includes(parseInt(formData.duration_minutes))) {
      setFormError('Для лодок длительность должна быть 60, 120 или 180 минут');
      return;
    }

    try {
      const payload = {
        product_type: formData.product_type,
        time: formData.time,
        duration_minutes: parseInt(formData.duration_minutes),
        capacity: parseInt(formData.capacity),
        price_adult: priceAdult,
        price_child: priceChild,
        ...(formData.product_type !== 'banana' && formData.price_teen ? { price_teen: priceTeen } : {}),
        is_active: parseInt(formData.is_active)
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
      resetForm();
      loadTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      const errorMessage = error.responseBody?.error || error.message;
      setFormError(errorMessage || 'Ошибка при сохранении шаблона');
    }
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      product_type: template.product_type,
      time: template.time,
      duration_minutes: template.duration_minutes?.toString() || '60',
      capacity: template.capacity?.toString() || '',
      price_adult: template.price_adult?.toString() || '',
      price_child: template.price_child?.toString() || '',
      price_teen: template.price_teen?.toString() || '',
      is_active: template.is_active
    });
    setShowForm(true);
  };

  const handleDelete = async (templateId) => {
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
    setEditingTemplate(null);
    setFormData({
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

  // Generate time options from 08:00 to 21:00 in 30-minute intervals
  const timeOptions = [];
  for (let hour = 8; hour <= 21; hour++) {
    timeOptions.push(`${hour.toString().padStart(2, '0')}:00`);
    if (hour < 21) {
      timeOptions.push(`${hour.toString().padStart(2, '0')}:30`);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-gray-800">Шаблоны рейсов</h3>
        <div className="flex space-x-2">
          <button
            onClick={() => {
              setEditingTemplate(null);
              setFormData({
                product_type: 'speed',
                time: '',
                duration_minutes: '60',
                capacity: '',
                price_adult: '',
                price_child: '',
                price_teen: '',
                is_active: 1
              });
              setShowForm(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Создать шаблон
          </button>
          <button
            onClick={onBack}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-medium hover:bg-gray-400 active:bg-gray-500 transition-colors"
          >
            Назад
          </button>
        </div>
      </div>

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

      {showForm && (
        <div className="mb-6 bg-white rounded-xl shadow-md p-6">
          <h4 className="text-lg font-bold mb-4">
            {editingTemplate ? 'Редактировать шаблон' : 'Создать новый шаблон'}
          </h4>
          
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Тип продукта
                </label>
                <select
                  name="product_type"
                  value={formData.product_type}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="speed">Скоростная лодка</option>
                  <option value="cruise">Прогулочная лодка</option>
                  <option value="banana">Банан</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Время (ЧЧ:ММ)
                </label>
                <select
                  name="time"
                  value={formData.time}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Выберите время</option>
                  {timeOptions.map(time => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
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
                  {formData.product_type === 'banana' ? (
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
                  disabled={formData.product_type === 'banana'} // For banana, capacity is fixed at 12
                />
                {formData.product_type === 'banana' && (
                  <p className="text-xs text-gray-500 mt-1">Для банана вместимость фиксирована: 12 мест</p>
                )}
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
                  {formData.product_type !== 'banana' && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Подросток</label>
                      <input
                        type="number"
                        value={formData.price_teen}
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
            </div>

            <div className="flex items-center mb-4">
              <input
                type="checkbox"
                name="is_active"
                id="is_active"
                checked={formData.is_active}
                onChange={handleInputChange}
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
                {editingTemplate ? 'Сохранить' : 'Создать'}
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
          <h4 className="font-medium text-gray-700">Все шаблоны</h4>
          {templates.map(template => (
            <div key={template.id} className="bg-white rounded-xl shadow-md p-4 flex justify-between items-center">
              <div>
                <div className="font-bold">
                  {template.product_type === 'speed' ? 'Скоростная' : 
                   template.product_type === 'cruise' ? 'Прогулочная' : 'Банан'} - {template.time}
                </div>
                <div className="text-sm text-gray-600">
                  Взр:{new Intl.NumberFormat('ru-RU').format(template.price_adult)} ₽ • 
                  {template.price_teen ? `Подр:${new Intl.NumberFormat('ru-RU').format(template.price_teen)} ₽ • ` : ''}
                  Реб:{new Intl.NumberFormat('ru-RU').format(template.price_child)} ₽ • 
                  Вместимость: {template.capacity} • {template.duration_minutes} мин
                </div>
                <div className="text-xs text-gray-500">
                  ID: {template.id} • {template.is_active ? 'Активный' : 'Неактивный'}
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleEdit(template)}
                  className="bg-blue-100 text-blue-800 px-3 py-1 rounded-lg text-sm font-medium hover:bg-blue-200 active:bg-blue-300 transition-colors"
                >
                  Редактировать
                </button>
                <button
                  onClick={() => handleDelete(template.id)}
                  className="bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-colors"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
          
          {templates.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Нет шаблонов
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TripTemplates;