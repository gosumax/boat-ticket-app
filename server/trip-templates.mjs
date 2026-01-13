import { Router } from 'express';
import db from './db.js';
import { authenticateToken, canDispatchManageSlots } from './auth.js';

const router = Router();

// Helper function to validate time format
const validateTimeFormat = (time) => {
  // Check if time matches HH:MM format
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    return false;
  }
  
  // Extract hour and minute
  const [hour, minute] = time.split(':').map(Number);
  
  // Check if hour is in range 08-21
  if (hour < 8 || hour > 21) {
    return false;
  }
  
  // Check if minute is 00 or 30
  if (minute !== 0 && minute !== 30) {
    return false;
  }
  
  return true;
};

// Helper function to validate duration based on service type
const validateDuration = (duration, serviceType) => {
  if (serviceType === 'BANANA') {
    // For banana: duration must be 40 minutes
    if (duration !== 40) {
      return { valid: false, error: 'Для банана длительность должна быть 40 минут' };
    }
  } else {
    // For boats: duration must be 60, 120, or 180 minutes
    if (duration && ![60, 120, 180].includes(duration)) {
      return { valid: false, error: 'Для лодки длительность должна быть 60, 120 или 180 минут' };
    }
  }
  
  return { valid: true };
};

// Get all trip templates
router.get('/templates', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templates = db.prepare(`
      SELECT 
        id, product_type, time, duration_minutes, capacity, is_active,
        price_adult, price_child, price_teen, created_at, updated_at
      FROM trip_templates
      ORDER BY product_type, time
    `).all();
    
    res.json(templates);
  } catch (error) {
    console.error('[TRIP_TEMPLATES_500] route=/api/selling/trip-templates/templates method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get a specific trip template
router.get('/templates/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    
    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    const template = db.prepare(`
      SELECT 
        id, product_type, time, duration_minutes, capacity, is_active,
        price_adult, price_child, price_teen, created_at, updated_at
      FROM trip_templates
      WHERE id = ?
    `).get(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('[TRIP_TEMPLATES_500] route=/api/selling/trip-templates/templates/:id method=GET id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create a new trip template
router.post('/templates', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { product_type, time, duration_minutes, capacity, price_adult, price_child, price_teen, is_active = 1 } = req.body;
    
    if (!product_type || !time || !capacity || !price_adult || !price_child) {
      return res.status(400).json({ error: 'product_type, time, capacity, price_adult, and price_child are required' });
    }
    
    // Validate product type
    if (!['speed', 'cruise', 'banana'].includes(product_type.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid product type. Must be speed, cruise, or banana' });
    }
    
    // Validate time format
    if (!validateTimeFormat(time)) {
      return res.status(400).json({ error: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
    }
    
    // Validate duration
    const serviceType = product_type.toLowerCase() === 'banana' ? 'BANANA' : 'BOAT';
    const durationValidation = validateDuration(parseInt(duration_minutes), serviceType);
    if (!durationValidation.valid) {
      return res.status(400).json({ error: durationValidation.error });
    }
    
    // Validate prices
    if (isNaN(price_adult) || price_adult <= 0) {
      return res.status(400).json({ error: 'Некорректная цена для взрослых' });
    }
    if (isNaN(price_child) || price_child <= 0) {
      return res.status(400).json({ error: 'Некорректная цена для детей' });
    }
    
    // For banana, price_teen should not be provided or should be 0/null
    if (product_type.toLowerCase() === 'banana' && (price_teen !== undefined && price_teen !== null && price_teen !== 0)) {
      return res.status(400).json({ error: 'Подростковый билет запрещён для banana' });
    }
    
    // Validate capacity
    if (product_type.toLowerCase() === 'banana' && capacity !== 12) {
      return res.status(400).json({ error: 'Для банана вместимость должна быть 12 мест' });
    }
    
    // Convert active to integer
    const isActive = is_active === true || is_active === 1 || is_active === '1' || is_active === 'true' ? 1 : 0;
    
    // Insert the template
    const stmt = db.prepare(`
      INSERT INTO trip_templates (
        product_type, time, duration_minutes, capacity, 
        price_adult, price_child, price_teen, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      product_type.toLowerCase(),
      time,
      parseInt(duration_minutes) || (product_type.toLowerCase() === 'banana' ? 40 : 60),
      parseInt(capacity),
      parseInt(price_adult),
      parseInt(price_child),
      price_teen !== undefined ? parseInt(price_teen) : null,
      isActive
    );
    
    // Get the created template
    const newTemplate = db.prepare(`
      SELECT 
        id, product_type, time, duration_minutes, capacity, is_active,
        price_adult, price_child, price_teen, created_at, updated_at
      FROM trip_templates
      WHERE id = ?
    `).get(result.lastInsertRowid);
    
    res.status(201).json(newTemplate);
  } catch (error) {
    console.error('[TRIP_TEMPLATES_500] route=/api/selling/trip-templates/templates method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Update a trip template
router.patch('/templates/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const { time, duration_minutes, capacity, price_adult, price_child, price_teen, is_active } = req.body;
    
    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    // Get current template to check product type
    const currentTemplate = db.prepare(`
      SELECT product_type
      FROM trip_templates
      WHERE id = ?
    `).get(templateId);
    
    if (!currentTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Build update query based on provided fields
    const updates = [];
    const params = [];
    
    if (time !== undefined) {
      // Validate time format
      if (!validateTimeFormat(time)) {
        return res.status(400).json({ error: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
      }
      updates.push('time = ?');
      params.push(time);
    }
    
    if (duration_minutes !== undefined) {
      // Validate duration
      const serviceType = currentTemplate.product_type === 'banana' ? 'BANANA' : 'BOAT';
      const durationValidation = validateDuration(parseInt(duration_minutes), serviceType);
      if (!durationValidation.valid) {
        return res.status(400).json({ error: durationValidation.error });
      }
      updates.push('duration_minutes = ?');
      params.push(parseInt(duration_minutes));
    }
    
    if (capacity !== undefined) {
      // For banana, capacity must be 12
      if (currentTemplate.product_type === 'banana' && capacity !== 12) {
        return res.status(400).json({ error: 'Для банана вместимость должна быть 12 мест' });
      }
      updates.push('capacity = ?');
      params.push(parseInt(capacity));
    }
    
    if (price_adult !== undefined) {
      if (isNaN(price_adult) || price_adult <= 0) {
        return res.status(400).json({ error: 'Некорректная цена для взрослых' });
      }
      updates.push('price_adult = ?');
      params.push(parseInt(price_adult));
    }
    
    if (price_child !== undefined) {
      if (isNaN(price_child) || price_child <= 0) {
        return res.status(400).json({ error: 'Некорректная цена для детей' });
      }
      updates.push('price_child = ?');
      params.push(parseInt(price_child));
    }
    
    if (price_teen !== undefined) {
      // For banana, price_teen should not be provided or should be 0/null
      if (currentTemplate.product_type === 'banana' && price_teen !== 0 && price_teen !== null) {
        return res.status(400).json({ error: 'Подростковый билет запрещён для banana' });
      }
      updates.push('price_teen = ?');
      params.push(parseInt(price_teen));
    }
    
    if (is_active !== undefined) {
      // Convert active to integer
      const isActive = is_active === true || is_active === 1 || is_active === '1' || is_active === 'true' ? 1 : 0;
      updates.push('is_active = ?');
      params.push(isActive);
    }
    
    // Add updated_at and template ID
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(templateId);
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const updateQuery = `UPDATE trip_templates SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(updateQuery).run(params);
    
    // Get the updated template
    const updatedTemplate = db.prepare(`
      SELECT 
        id, product_type, time, duration_minutes, capacity, is_active,
        price_adult, price_child, price_teen, created_at, updated_at
      FROM trip_templates
      WHERE id = ?
    `).get(templateId);
    
    res.json(updatedTemplate);
  } catch (error) {
    console.error('[TRIP_TEMPLATES_500] route=/api/selling/trip-templates/templates/:id method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete a trip template
router.delete('/templates/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    
    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    // Check if template exists
    const template = db.prepare('SELECT id FROM trip_templates WHERE id = ?').get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Delete the template
    const stmt = db.prepare('DELETE FROM trip_templates WHERE id = ?');
    const result = stmt.run(templateId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ message: 'Template deleted', id: templateId });
  } catch (error) {
    console.error('[TRIP_TEMPLATES_500] route=/api/selling/trip-templates/templates/:id method=DELETE id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;