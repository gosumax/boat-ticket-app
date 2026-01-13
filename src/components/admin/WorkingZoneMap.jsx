import { useState, useEffect } from 'react';
import apiClient from '../../utils/apiClient';

const WorkingZoneMap = () => {
  const [map, setMap] = useState(null);
  const [polygon, setPolygon] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Initialize map
    const initMap = () => {
      // This is a placeholder for the actual map implementation
      // In a real implementation, you would use Leaflet or Google Maps here
      console.log('Initializing map...');
    };

    initMap();
    
    // Load existing working zone
    loadWorkingZone();
  }, []);

  const loadWorkingZone = async () => {
    try {
      const zoneData = await apiClient.getWorkingZone();
      if (zoneData && zoneData.geometry) {
        setPolygon(zoneData);
      }
    } catch (err) {
      setError('Не удалось загрузить рабочую зону');
    }
  };

  const saveWorkingZone = async () => {
    if (!polygon) return;
    
    try {
      await apiClient.saveWorkingZone(polygon);
      setIsEditing(false);
      setError('');
    } catch (err) {
      setError('Не удалось сохранить рабочую зону');
    }
  };

  const startEditing = () => {
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    loadWorkingZone(); // Reload the original zone
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="mb-6 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
        </div>
      )}
      
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Рабочая зона</h2>
          <div className="space-x-2">
            {isEditing ? (
              <>
                <button
                  onClick={saveWorkingZone}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                >
                  Сохранить
                </button>
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700"
                >
                  Отмена
                </button>
              </>
            ) : (
              <button
                onClick={startEditing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Редактировать
              </button>
            )}
          </div>
        </div>
        
        <div className="border-2 border-dashed border-gray-300 rounded-lg h-96 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="text-lg mb-2">Карта рабочей зоны</div>
            <div className="text-sm">
              {isEditing 
                ? 'Нарисуйте или отредактируйте полигон зоны' 
                : polygon 
                  ? 'Отображается текущая рабочая зона' 
                  : 'Рабочая зона не установлена'}
            </div>
          </div>
        </div>
        
        {isEditing && (
          <div className="mt-4 text-sm text-gray-600">
            <p>Используйте инструменты рисования для создания или изменения полигона рабочей зоны.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkingZoneMap;