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

// Get all schedule templates
router.get('/schedule-templates', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templates = db.prepare(`
      SELECT 
        st.id, st.weekday, st.time, st.product_type, st.boat_id, st.boat_type, st.capacity, st.is_active,
        st.price_adult, st.price_child, st.price_teen, st.duration_minutes, st.created_at, st.updated_at,
        b.name as boat_name
      FROM schedule_templates st
      LEFT JOIN boats b ON st.boat_id = b.id
      ORDER BY st.weekday, st.time
    `).all();
    
    res.json(templates);
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get a specific schedule template
router.get('/schedule-templates/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    
    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    const template = db.prepare(`
      SELECT 
        st.id, st.weekday, st.time, st.product_type, st.boat_id, st.boat_type, st.capacity, st.is_active,
        st.price_adult, st.price_child, st.price_teen, st.duration_minutes, st.created_at, st.updated_at,
        b.name as boat_name
      FROM schedule_templates st
      LEFT JOIN boats b ON st.boat_id = b.id
      WHERE st.id = ?
    `).get(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates/:id method=GET id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create a new schedule template
router.post('/schedule-templates', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active = 1 } = req.body;
    
    if (!weekday || !time || !product_type || !capacity || !price_adult || !price_child || !duration_minutes) {
      return res.status(400).json({ error: 'weekday, time, product_type, capacity, price_adult, price_child, and duration_minutes are required' });
    }
    
    // Validate weekday (1-7)
    if (isNaN(weekday) || weekday < 1 || weekday > 7) {
      return res.status(400).json({ error: 'weekday must be between 1 and 7 (1=Monday, 7=Sunday)' });
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
    
    // If boat_id is provided, validate that the boat exists
    if (boat_id) {
      const boat = db.prepare('SELECT id, type FROM boats WHERE id = ?').get(boat_id);
      if (!boat) {
        return res.status(404).json({ error: 'Boat not found' });
      }
      // If boat exists, ensure product_type matches boat type
      if (boat.type !== product_type.toLowerCase()) {
        return res.status(400).json({ error: 'Product type must match boat type' });
      }
    }
    
    // Convert active to integer
    const isActive = is_active === true || is_active === 1 || is_active === '1' || is_active === 'true' ? 1 : 0;
    
    // Insert the template
    const stmt = db.prepare(`
      INSERT INTO schedule_templates (
        weekday, time, product_type, boat_id, boat_type, capacity, 
        price_adult, price_child, price_teen, duration_minutes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      parseInt(weekday),
      time,
      product_type.toLowerCase(),
      boat_id ? parseInt(boat_id) : null,
      boat_type || null,
      parseInt(capacity),
      parseInt(price_adult),
      parseInt(price_child),
      price_teen !== undefined ? parseInt(price_teen) : null,
      parseInt(duration_minutes),
      isActive
    );
    
    // Get the created template
    const newTemplate = db.prepare(`
      SELECT 
        st.id, st.weekday, st.time, st.product_type, st.boat_id, st.boat_type, st.capacity, st.is_active,
        st.price_adult, st.price_child, st.price_teen, st.duration_minutes, st.created_at, st.updated_at,
        b.name as boat_name
      FROM schedule_templates st
      LEFT JOIN boats b ON st.boat_id = b.id
      WHERE st.id = ?
    `).get(result.lastInsertRowid);
    
    // Optionally trigger generation for the next 14 days after creating a template
    // This can be configured based on requirements
    const autoGenerate = req.body.auto_generate !== false; // Default to true unless explicitly disabled
    if (autoGenerate) {
      try {
        const fromDate = new Date().toISOString().split('T')[0]; // Today
        const toDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 14 days from now
        
        // Generate slots for this specific template
        const generatedData = generateSlotsForTemplateId(newTemplate.id, fromDate, toDate);
        
        console.log('[TEMPLATE_GEN] templateId=' + newTemplate.id + ' created=' + generatedData.created + ' skipped=' + generatedData.skipped);
      } catch (genError) {
        // Log the error but don't fail the template creation
        console.error('[SCHEDULE_TEMPLATES_AUTOGEN_ERROR] templateId=' + newTemplate.id + ' message=' + genError.message + ' stack=' + genError.stack);
      }
    }
    
    res.status(201).json(newTemplate);
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Helper function to generate slots for a specific template ID
function generateSlotsForTemplateId(templateId, dateFrom, dateTo) {
  const template = db.prepare(`
    SELECT * FROM schedule_templates WHERE id = ? AND is_active = 1
  `).get(templateId);
  
  if (!template) {
    throw new Error('Template not found or not active');
  }
  
  const fromDate = new Date(dateFrom);
  const toDate = new Date(dateTo);
  
  // Calculate the number of days between the dates
  const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
  const diffDays = Math.round(Math.abs((toDate - fromDate) / oneDay)) + 1;
  
  const generatedSlots = [];
  const skippedSlots = [];
  
  // Loop through each day
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    // Get the day of week (1=Monday, 7=Sunday)
    const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // Convert Sunday from 0 to 7
    
    // Check if this template runs on this day of week
    if (template.weekday !== dayOfWeek) {
      continue;
    }
    
    // Check if a slot already exists for this date and time for the same boat
    const tripDate = d.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    const existingSlot = db.prepare(`
      SELECT id FROM generated_slots 
      WHERE trip_date = ? AND time = ? AND boat_id = ?
    `).get(tripDate, template.time, template.boat_id);
    
    if (existingSlot) {
      // Skip if slot already exists
      skippedSlots.push({
        date: tripDate,
        time: template.time,
        boat_id: template.boat_id,
        reason: 'already_exists'
      });
      continue;
    }
    
    // Create a new generated slot based on the template
    const insertResult = db.prepare(`
      INSERT INTO generated_slots (
        schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
        duration_minutes, is_active, price_adult, price_child, price_teen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      tripDate,
      template.boat_id,
      template.time,
      template.capacity,
      template.capacity, // seats_left starts as capacity
      template.duration_minutes,
      1, // is_active = 1 by default
      template.price_adult,
      template.price_child,
      template.price_teen
    );
    
    generatedSlots.push({
      id: insertResult.lastInsertRowid,
      schedule_template_id: template.id,
      trip_date: tripDate,
      boat_id: template.boat_id,
      time: template.time
    });
  }
  
  return {
    created: generatedSlots.length,
    skipped: skippedSlots.length,
    generated_slots: generatedSlots,
    skipped_slots: skippedSlots
  };
}

// Generate slots for a specific template ID
router.post('/schedule-templates/:id/generate', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const { fromDate, days } = req.body;
    
    if (isNaN(templateId)) {
      return res.status(400).json({ 
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Invalid template ID' 
      });
    }
    
    if (!fromDate) {
      return res.status(400).json({ 
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'fromDate is required' 
      });
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate)) {
      return res.status(400).json({ 
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }
    
    // Calculate toDate based on days if provided, otherwise default to 14 days
    let toDate;
    if (days !== undefined) {
      const daysNum = parseInt(days);
      if (isNaN(daysNum) || daysNum <= 0) {
        return res.status(400).json({ 
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'days must be a positive integer' 
        });
      }
      const fromDateObj = new Date(fromDate);
      const toDateObj = new Date(fromDateObj.getTime() + (daysNum - 1) * 24 * 60 * 60 * 1000);
      toDate = toDateObj.toISOString().split('T')[0];
    } else {
      // Default to 14 days if not specified
      const fromDateObj = new Date(fromDate);
      const toDateObj = new Date(fromDateObj.getTime() + 13 * 24 * 60 * 60 * 1000); // 14 days total
      toDate = toDateObj.toISOString().split('T')[0];
    }
    
    const result = generateSlotsForTemplateId(templateId, fromDate, toDate);
    
    console.log('[TEMPLATE_GEN] templateId=' + templateId + ' created=' + result.created + ' skipped=' + result.skipped);
    
    res.json({
      ok: true,
      message: `Generated ${result.created} slots, skipped ${result.skipped} slots for template ${templateId}`,
      created: result.created,
      skipped: result.skipped,
      reasons: {
        already_exists: result.skipped_slots.filter(s => s.reason === 'already_exists').length
      },
      generated_slots: result.generated_slots,
      skipped_slots: result.skipped_slots
    });
  } catch (error) {
    if (error.message === 'Template not found or not active') {
      return res.status(404).json({ 
        ok: false,
        code: 'NOT_FOUND',
        message: error.message 
      });
    }
    
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates/:id/generate method=POST id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Update a schedule template
router.patch('/schedule-templates/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const { weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active } = req.body;
    
    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    // Get current template to check product type
    const currentTemplate = db.prepare(`
      SELECT product_type
      FROM schedule_templates
      WHERE id = ?
    `).get(templateId);
    
    if (!currentTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Build update query based on provided fields
    const updates = [];
    const params = [];
    
    if (weekday !== undefined) {
      // Validate weekday (1-7)
      if (isNaN(weekday) || weekday < 1 || weekday > 7) {
        return res.status(400).json({ error: 'weekday must be between 1 and 7 (1=Monday, 7=Sunday)' });
      }
      updates.push('weekday = ?');
      params.push(parseInt(weekday));
    }
    
    if (time !== undefined) {
      // Validate time format
      if (!validateTimeFormat(time)) {
        return res.status(400).json({ error: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
      }
      updates.push('time = ?');
      params.push(time);
    }
    
    if (product_type !== undefined) {
      // Validate product type
      if (!['speed', 'cruise', 'banana'].includes(product_type.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid product type. Must be speed, cruise, or banana' });
      }
      updates.push('product_type = ?');
      params.push(product_type.toLowerCase());
    }
    
    if (duration_minutes !== undefined) {
      // Validate duration
      const serviceType = (product_type || currentTemplate.product_type).toLowerCase() === 'banana' ? 'BANANA' : 'BOAT';
      const durationValidation = validateDuration(parseInt(duration_minutes), serviceType);
      if (!durationValidation.valid) {
        return res.status(400).json({ error: durationValidation.error });
      }
      updates.push('duration_minutes = ?');
      params.push(parseInt(duration_minutes));
    }
    
    if (capacity !== undefined) {
      // For banana, capacity must be 12
      if ((product_type || currentTemplate.product_type).toLowerCase() === 'banana' && capacity !== 12) {
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
      if ((product_type || currentTemplate.product_type).toLowerCase() === 'banana' && price_teen !== 0 && price_teen !== null) {
        return res.status(400).json({ error: 'Подростковый билет запрещён для banana' });
      }
      updates.push('price_teen = ?');
      params.push(parseInt(price_teen));
    }
    
    if (boat_id !== undefined) {
      if (boat_id !== null) {
        // If boat_id is provided, validate that the boat exists
        const boat = db.prepare('SELECT id, type FROM boats WHERE id = ?').get(boat_id);
        if (!boat) {
          return res.status(404).json({ error: 'Boat not found' });
        }
        // If boat exists, ensure product_type matches boat type
        if (boat.type !== (product_type || currentTemplate.product_type).toLowerCase()) {
          return res.status(400).json({ error: 'Product type must match boat type' });
        }
      }
      updates.push('boat_id = ?');
      params.push(boat_id !== null ? parseInt(boat_id) : null);
    }
    
    if (boat_type !== undefined) {
      updates.push('boat_type = ?');
      params.push(boat_type);
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
    
    const updateQuery = `UPDATE schedule_templates SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(updateQuery).run(params);
    
    // Get the updated template
    const updatedTemplate = db.prepare(`
      SELECT 
        st.id, st.weekday, st.time, st.product_type, st.boat_id, st.boat_type, st.capacity, st.is_active,
        st.price_adult, st.price_child, st.price_teen, st.duration_minutes, st.created_at, st.updated_at,
        b.name as boat_name
      FROM schedule_templates st
      LEFT JOIN boats b ON st.boat_id = b.id
      WHERE st.id = ?
    `).get(templateId);
    
    res.json(updatedTemplate);
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates/:id method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete a schedule template
router.delete('/schedule-templates/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    
    if (isNaN(templateId)) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    // Check if template exists
    const template = db.prepare('SELECT id FROM schedule_templates WHERE id = ?').get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Delete the template
    const stmt = db.prepare('DELETE FROM schedule_templates WHERE id = ?');
    const result = stmt.run(templateId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ message: 'Template deleted', id: templateId });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates/:id method=DELETE id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Generate slots from schedule templates for a date range
router.post('/schedule-templates/generate', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { date_from, date_to } = req.body;
    
    if (!date_from || !date_to) {
      return res.status(400).json({ error: 'date_from and date_to are required' });
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date_from) || !dateRegex.test(date_to)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Validate that date_from is not after date_to
    const fromDate = new Date(date_from);
    const toDate = new Date(date_to);
    if (fromDate > toDate) {
      return res.status(400).json({ error: 'date_from cannot be after date_to' });
    }
    
    // Get all active schedule templates
    const templates = db.prepare(`
      SELECT * FROM schedule_templates WHERE is_active = 1
    `).all();
    
    if (templates.length === 0) {
      return res.json({ message: 'No active templates found', generated: 0 });
    }
    
    // Calculate the number of days between the dates
    const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
    const diffDays = Math.round(Math.abs((toDate - fromDate) / oneDay)) + 1;
    
    // Process each day in the range
    const generatedSlots = [];
    const skippedSlots = [];
    
    // Loop through each day
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      // Get the day of week (1=Monday, 7=Sunday)
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // Convert Sunday from 0 to 7
      
      // Find templates that match this day of week
      const matchingTemplates = templates.filter(t => t.weekday === dayOfWeek);
      
      for (const template of matchingTemplates) {
        // Check if a slot already exists for this date and time for the same boat
        const tripDate = d.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        const existingSlot = db.prepare(`
          SELECT id FROM generated_slots 
          WHERE trip_date = ? AND time = ? AND boat_id = ?
        `).get(tripDate, template.time, template.boat_id);
        
        if (existingSlot) {
          // Skip if slot already exists
          skippedSlots.push({
            date: tripDate,
            time: template.time,
            boat_id: template.boat_id,
            reason: 'already_exists'
          });
          continue;
        }
        
        // Create a new generated slot based on the template
        const insertResult = db.prepare(`
          INSERT INTO generated_slots (
            schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
            duration_minutes, is_active, price_adult, price_child, price_teen
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          template.id,
          tripDate,
          template.boat_id,
          template.time,
          template.capacity,
          template.capacity, // seats_left starts as capacity
          template.duration_minutes,
          1, // is_active = 1 by default
          template.price_adult,
          template.price_child,
          template.price_teen
        );
        
        // Get the created slot
        const newSlot = db.prepare(`
          SELECT 
            gs.id, gs.schedule_template_id, gs.trip_date, gs.boat_id, gs.time, gs.capacity, gs.seats_left,
            gs.duration_minutes, gs.is_active, gs.price_adult, gs.price_child, gs.price_teen,
            b.name as boat_name, b.type as boat_type
          FROM generated_slots gs
          JOIN boats b ON gs.boat_id = b.id
          WHERE gs.id = ?
        `).get(insertResult.lastInsertRowid);
        
        generatedSlots.push(newSlot);
      }
    }
    
    res.json({
      message: `Generated ${generatedSlots.length} slots, skipped ${skippedSlots.length} slots`,
      generated: generatedSlots.length,
      skipped: skippedSlots.length,
      generated_slots: generatedSlots,
      skipped_slots: skippedSlots
    });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATES_500] route=/api/selling/schedule-templates/generate method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get all generated slots for a date range
router.get('/generated-slots', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { date_from, date_to, date } = req.query;
    
    let query = `
      SELECT 
        gs.id, gs.schedule_template_id, gs.trip_date, gs.boat_id, gs.time, gs.capacity, gs.seats_left,
        gs.duration_minutes, gs.is_active, gs.price_adult, gs.price_child, gs.price_teen,
        b.name as boat_name, b.type as boat_type
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
    `;
    const params = [];
    
    if (date) {
      // Filter by specific date
      query += ' WHERE gs.trip_date = ?';
      params.push(date);
    } else if (date_from || date_to) {
      query += ' WHERE 1=1';
      if (date_from) {
        query += ' AND gs.trip_date >= ?';
        params.push(date_from);
      }
      if (date_to) {
        query += ' AND gs.trip_date <= ?';
        params.push(date_to);
      }
    }
    
    query += ' ORDER BY gs.trip_date, gs.time';
    
    const slots = db.prepare(query).all(...params);
    
    res.json(slots);
  } catch (error) {
    console.error('[GENERATED_SLOTS_500] route=/api/selling/generated-slots method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get generated slots that are active and available for selling
router.get('/generated-slots/active', authenticateToken, (req, res) => {
  try {
    const slots = db.prepare(`
      SELECT 
        gs.id, gs.schedule_template_id, gs.trip_date, gs.boat_id, gs.time, gs.capacity, gs.seats_left,
        gs.duration_minutes, gs.is_active, gs.price_adult, gs.price_child, gs.price_teen,
        b.name as boat_name, b.type as boat_type
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
      WHERE gs.is_active = 1 AND gs.seats_left > 0 AND b.is_active = 1
      ORDER BY gs.trip_date, gs.time
    `).all();
    
    console.log('[GENERATED_SLOTS_ACTIVE] total_generated_active_slots_returned=', slots.length);
    if (slots.length > 0) {
      console.log('[GENERATED_SLOTS_ACTIVE] sample_slots:', slots.slice(0, 3).map(s => ({
        id: s.id, 
        boat_name: s.boat_name, 
        time: s.time, 
        is_active: s.is_active, 
        trip_date: s.trip_date,
        seats_left: s.seats_left
      })));
    }
    
    res.json(slots);
  } catch (error) {
    console.error('[GENERATED_SLOTS_500] route=/api/selling/generated-slots/active method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;