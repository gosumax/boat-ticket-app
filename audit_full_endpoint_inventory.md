# Full Endpoint Inventory

Generated: 2026-03-30T03:11:07.054Z
Source: audit_endpoint_contract_map.json (static extraction; validate edge contracts manually).

Total endpoints: 136

## .mjs (33)

### GET UNMOUNTED/boats
- file: `server/.mjs`:245
- mount: `UNMOUNTED`
- route: `/boats`
- role_access: `seller|dispatcher`
- input_contract: params=[type] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE boat_slots]
- frontend_consumers: none_detected

### GET UNMOUNTED/boats/:type/slots
- file: `server/.mjs`:265
- mount: `UNMOUNTED`
- route: `/boats/:type/slots`
- role_access: `seller|dispatcher`
- input_contract: params=[type] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### POST UNMOUNTED/presales
- file: `server/.mjs`:444
- mount: `UNMOUNTED`
- route: `/presales`
- role_access: `seller|dispatcher`
- input_contract: params=[type] query=[] body=[tickets, trip_date, tripDate, slotUid, customerName, customerPhone, numberOfSeats, prepaymentAmount, prepaymentComment]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET UNMOUNTED/presales
- file: `server/.mjs`:1043
- mount: `UNMOUNTED`
- route: `/presales`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET UNMOUNTED/presales/cancelled-trip-pending
- file: `server/.mjs`:1086
- mount: `UNMOUNTED`
- route: `/presales/cancelled-trip-pending`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[boat_id, time, capacity, duration_minutes, active, price_adult, price_child, price_teen]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET UNMOUNTED/presales/:id
- file: `server/.mjs`:1134
- mount: `UNMOUNTED`
- route: `/presales/:id`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[boat_id, time, capacity, duration_minutes, active, price_adult, price_child, price_teen]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### POST UNMOUNTED/dispatcher/slots
- file: `server/.mjs`:1191
- mount: `UNMOUNTED`
- route: `/dispatcher/slots`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[boat_id, time, capacity, duration_minutes, active, price_adult, price_child, price_teen, price]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO boat_slots; UPDATE a]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/dispatcher/slots/:id
- file: `server/.mjs`:1303
- mount: `UNMOUNTED`
- route: `/dispatcher/slots/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[time, price, capacity, duration_minutes, active, price_adult, price_child, price_teen]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE a; UPDATE const]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/dispatcher/slots/:id/active
- file: `server/.mjs`:1539
- mount: `UNMOUNTED`
- route: `/dispatcher/slots/:id/active`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[active]
- output_contract: json_keys=[debug, endpoint, updatedPresales]
- side_effects: db_writes=[UPDATE const; UPDATE presales; UPDATE slot; UPDATE all; UPDATE the; UPDATE boat_slots]
- frontend_consumers: none_detected

### DELETE UNMOUNTED/dispatcher/slots/:id
- file: `server/.mjs`:1628
- mount: `UNMOUNTED`
- route: `/dispatcher/slots/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[ok, mode, message, slot, id]
- side_effects: db_writes=[UPDATE the; UPDATE boat_slots; DELETE FROM boat_slots]
- frontend_consumers: none_detected

### GET UNMOUNTED/dispatcher/boats
- file: `server/.mjs`:1705
- mount: `UNMOUNTED`
- route: `/dispatcher/boats`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[additionalPayment]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE prepayment; UPDATE presales]
- frontend_consumers: none_detected

### GET UNMOUNTED/dispatcher/slots
- file: `server/.mjs`:1716
- mount: `UNMOUNTED`
- route: `/dispatcher/slots`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[additionalPayment]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE prepayment; UPDATE presales]
- frontend_consumers: none_detected

### GET UNMOUNTED/slots
- file: `server/.mjs`:1759
- mount: `UNMOUNTED`
- route: `/slots`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[additionalPayment]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE prepayment; UPDATE presales]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/payment
- file: `server/.mjs`:1801
- mount: `UNMOUNTED`
- route: `/presales/:id/payment`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[additionalPayment]
- output_contract: json_keys=[success, presale]
- side_effects: db_writes=[UPDATE presale; UPDATE prepayment; UPDATE presales]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/paid
- file: `server/.mjs`:1861
- mount: `UNMOUNTED`
- route: `/presales/:id/paid`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success, presale]
- side_effects: db_writes=[UPDATE presales; UPDATE prepayment]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/accept-payment
- file: `server/.mjs`:1954
- mount: `UNMOUNTED`
- route: `/presales/:id/accept-payment`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success, presale]
- side_effects: db_writes=[UPDATE prepayment; UPDATE presales; UPDATE presale; UPDATE tickets; UPDATE the; UPDATE all; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/cancel
- file: `server/.mjs`:2010
- mount: `UNMOUNTED`
- route: `/presales/:id/cancel`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[target_slot_id]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE tickets; UPDATE the; UPDATE presales; UPDATE all; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/move
- file: `server/.mjs`:2125
- mount: `UNMOUNTED`
- route: `/presales/:id/move`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[target_slot_id]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; INSERT INTO boat_slots; UPDATE the; UPDATE presales; UPDATE tickets; UPDATE boat_slots; UPDATE target]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/seats
- file: `server/.mjs`:2323
- mount: `UNMOUNTED`
- route: `/presales/:id/seats`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[number_of_seats, comment]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE the; UPDATE presales; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/used
- file: `server/.mjs`:2432
- mount: `UNMOUNTED`
- route: `/presales/:id/used`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE the; UPDATE presales; UPDATE presale; UPDATE tickets; UPDATE all; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/refund
- file: `server/.mjs`:2499
- mount: `UNMOUNTED`
- route: `/presales/:id/refund`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE tickets; UPDATE the; UPDATE presales; UPDATE all; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/delete
- file: `server/.mjs`:2613
- mount: `UNMOUNTED`
- route: `/presales/:id/delete`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id, slotId] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presales; UPDATE tickets; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### GET UNMOUNTED/presales/:id/tickets
- file: `server/.mjs`:2700
- mount: `UNMOUNTED`
- route: `/presales/:id/tickets`
- role_access: `seller|dispatcher`
- input_contract: params=[id, slotId, ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE generated_slots]
- frontend_consumers: none_detected

### GET UNMOUNTED/slots/:slotId/tickets
- file: `server/.mjs`:2725
- mount: `UNMOUNTED`
- route: `/slots/:slotId/tickets`
- role_access: `seller|dispatcher`
- input_contract: params=[id, slotId, ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/tickets/:ticketId/used
- file: `server/.mjs`:2770
- mount: `UNMOUNTED`
- route: `/tickets/:ticketId/used`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[slotId, ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/tickets/:ticketId/refund
- file: `server/.mjs`:2805
- mount: `UNMOUNTED`
- route: `/tickets/:ticketId/refund`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/tickets/:ticketId/delete
- file: `server/.mjs`:2862
- mount: `UNMOUNTED`
- route: `/tickets/:ticketId/delete`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### POST UNMOUNTED/tickets/:ticketId/transfer
- file: `server/.mjs`:3126
- mount: `UNMOUNTED`
- route: `/tickets/:ticketId/transfer`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[success]
- side_effects: db_writes=[UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/tickets/:ticketId/transfer
- file: `server/.mjs`:3127
- mount: `UNMOUNTED`
- route: `/tickets/:ticketId/transfer`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[success]
- side_effects: db_writes=[UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### GET UNMOUNTED/transfer-options
- file: `server/.mjs`:3132
- mount: `UNMOUNTED`
- route: `/transfer-options`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### POST UNMOUNTED/presales/:id/transfer
- file: `server/.mjs`:3337
- mount: `UNMOUNTED`
- route: `/presales/:id/transfer`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success, message]
- side_effects: db_writes=[UPDATE presales]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/transfer
- file: `server/.mjs`:3359
- mount: `UNMOUNTED`
- route: `/presales/:id/transfer`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success, message]
- side_effects: db_writes=[UPDATE presales]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/presales/:id/cancel-trip-pending
- file: `server/.mjs`:3381
- mount: `UNMOUNTED`
- route: `/presales/:id/cancel-trip-pending`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success, message]
- side_effects: db_writes=[UPDATE presales]
- frontend_consumers: none_detected

## admin.mjs (17)

### GET /api/admin/boats
- file: `server/admin.mjs`:18
- mount: `/api/admin`
- route: `/boats`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[showArchived] body=[name, type, is_active]
- output_contract: json_keys=[boat]
- side_effects: db_writes=[INSERT INTO boats; UPDATE a; UPDATE boats; UPDATE boat]
- frontend_consumers: none_detected

### GET /api/admin/boats/:id
- file: `server/admin.mjs`:43
- mount: `/api/admin`
- route: `/boats/:id`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[name, type, is_active]
- output_contract: json_keys=[boat, ok, message, slots, generated_slots]
- side_effects: db_writes=[INSERT INTO boats; UPDATE a; UPDATE boats; UPDATE boat; DELETE FROM boats]
- frontend_consumers: none_detected

### POST /api/admin/boats
- file: `server/admin.mjs`:60
- mount: `/api/admin`
- route: `/boats`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[name, type, is_active]
- output_contract: json_keys=[boat, ok, message, slots, generated_slots]
- side_effects: db_writes=[INSERT INTO boats; UPDATE a; UPDATE boats; UPDATE boat; DELETE FROM boats]
- frontend_consumers: none_detected

### PUT /api/admin/boats/:id
- file: `server/admin.mjs`:86
- mount: `/api/admin`
- route: `/boats/:id`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[name, type, is_active, time, price, capacity, duration_minutes, price_adult, price_child, price_teen]
- output_contract: json_keys=[boat, ok, message, slots, generated_slots]
- side_effects: db_writes=[UPDATE a; UPDATE boats; UPDATE boat; DELETE FROM boats]
- frontend_consumers: none_detected

### PATCH /api/admin/boats/:id/active
- file: `server/admin.mjs`:117
- mount: `/api/admin`
- route: `/boats/:id/active`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[is_active, time, price, capacity, duration_minutes, price_adult, price_child, price_teen]
- output_contract: json_keys=[boat, ok, message, slots, generated_slots]
- side_effects: db_writes=[UPDATE boat; UPDATE boats; DELETE FROM boats; INSERT INTO boat_slots]
- frontend_consumers: none_detected

### DELETE /api/admin/boats/:id
- file: `server/admin.mjs`:142
- mount: `/api/admin`
- route: `/boats/:id`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[role] body=[time, price, capacity, duration_minutes, price_adult, price_child, price_teen]
- output_contract: json_keys=[boat, ok, message, slots, generated_slots]
- side_effects: db_writes=[UPDATE boat; UPDATE boats; DELETE FROM boats; INSERT INTO boat_slots]
- frontend_consumers: none_detected

### GET /api/admin/boats/:id/slots
- file: `server/admin.mjs`:183
- mount: `/api/admin`
- route: `/boats/:id/slots`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[role] body=[time, price, capacity, duration_minutes, price_adult, price_child, price_teen, username, password, role]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[INSERT INTO boat_slots; INSERT INTO users]
- frontend_consumers: none_detected

### POST /api/admin/boats/:id/slots
- file: `server/admin.mjs`:219
- mount: `/api/admin`
- route: `/boats/:id/slots`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[id] query=[role] body=[time, price, capacity, duration_minutes, price_adult, price_child, price_teen, username, password, role, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO boat_slots; INSERT INTO users; UPDATE a; UPDATE users; UPDATE user]
- frontend_consumers: none_detected

### GET /api/admin/users
- file: `server/admin.mjs`:267
- mount: `/api/admin`
- route: `/users`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[id] query=[role] body=[username, password, role, is_active]
- output_contract: json_keys=[ok, userId]
- side_effects: db_writes=[INSERT INTO users; UPDATE a; UPDATE users; UPDATE user]
- frontend_consumers: none_detected

### POST /api/admin/users
- file: `server/admin.mjs`:291
- mount: `/api/admin`
- route: `/users`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[id] query=[] body=[username, password, role, is_active]
- output_contract: json_keys=[ok, userId]
- side_effects: db_writes=[INSERT INTO users; UPDATE a; UPDATE users; UPDATE user]
- frontend_consumers: none_detected

### PATCH /api/admin/users/:id
- file: `server/admin.mjs`:332
- mount: `/api/admin`
- route: `/users/:id`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[id] query=[] body=[is_active, password]
- output_contract: json_keys=[ok, userId]
- side_effects: db_writes=[UPDATE a; UPDATE users; UPDATE user]
- frontend_consumers: none_detected

### POST /api/admin/users/:id/reset-password
- file: `server/admin.mjs`:356
- mount: `/api/admin`
- route: `/users/:id/reset-password`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[id] query=[] body=[password]
- output_contract: json_keys=[ok, userId]
- side_effects: db_writes=[UPDATE user; UPDATE users]
- frontend_consumers: none_detected

### DELETE /api/admin/users/:id
- file: `server/admin.mjs`:390
- mount: `/api/admin`
- route: `/users/:id`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[id] query=[] body=[coordinates, geometry]
- output_contract: json_keys=[ok, userId]
- side_effects: db_writes=[UPDATE users; UPDATE work]
- frontend_consumers: none_detected

### GET /api/admin/stats
- file: `server/admin.mjs`:419
- mount: `/api/admin`
- route: `/stats`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[coordinates, geometry]
- output_contract: json_keys=[ok, userId]
- side_effects: db_writes=[UPDATE work; UPDATE the; UPDATE settings; INSERT INTO settings]
- frontend_consumers:
  - src/views/AdminView.jsx:54 via apiClient.get call=/api/admin/stats

### GET /api/admin/work-zone
- file: `server/admin.mjs`:475
- mount: `/api/admin`
- route: `/work-zone`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[coordinates, geometry]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[UPDATE work; UPDATE the; UPDATE settings; INSERT INTO settings]
- frontend_consumers: none_detected

### GET /api/admin/settings/working-zone
- file: `server/admin.mjs`:499
- mount: `/api/admin`
- route: `/settings/working-zone`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[coordinates, geometry]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[UPDATE work; UPDATE the; UPDATE settings; INSERT INTO settings]
- frontend_consumers: none_detected

### PUT /api/admin/settings/working-zone
- file: `server/admin.mjs`:523
- mount: `/api/admin`
- route: `/settings/working-zone`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[coordinates, geometry]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[UPDATE work; UPDATE the; UPDATE settings; INSERT INTO settings]
- frontend_consumers: none_detected

## auth.js (2)

### POST /api/auth/login
- file: `server/auth.js`:141
- mount: `/api/auth`
- route: `/login`
- role_access: `public`
- input_contract: params=[] query=[] body=[username, password]
- output_contract: json_keys=[user, id, username, role]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/auth/me
- file: `server/auth.js`:167
- mount: `/api/auth`
- route: `/me`
- role_access: `authenticated`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[user, id, username, role]
- side_effects: db_writes=[]
- frontend_consumers:
  - src\contexts\AuthContext.jsx:34 via apiClient.getCurrentUser call=/api/auth/me

## dispatcher-shift-ledger.mjs (2)

### GET /api/dispatcher/shift-ledger/summary
- file: `server/dispatcher-shift-ledger.mjs`:204
- mount: `/api/dispatcher/shift-ledger`
- route: `/summary`
- role_access: `authenticated`
- input_contract: params=[] query=[business_day, trip_day, day] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/dispatcher/summary
- file: `server/dispatcher-shift-ledger.mjs`:204
- mount: `/api/dispatcher`
- route: `/summary`
- role_access: `authenticated`
- input_contract: params=[] query=[business_day, trip_day, day] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

## dispatcher-shift.mjs (3)

### GET /api/dispatcher/shift/diagnose
- file: `server/dispatcher-shift.mjs`:135
- mount: `/api/dispatcher/shift`
- route: `/diagnose`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[type, amount, seller_id, business_day]
- output_contract: json_keys=[ok, business_day]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### POST /api/dispatcher/shift/deposit
- file: `server/dispatcher-shift.mjs`:222
- mount: `/api/dispatcher/shift`
- route: `/deposit`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[type, amount, seller_id, business_day]
- output_contract: json_keys=[ok, business_day, amount, is_closed, source, closed_at, closed_by]
- side_effects: db_writes=[INSERT INTO money_ledger]
- frontend_consumers:
  - src/views/DispatcherShiftClose.jsx:363 via apiClient.request call=/api/dispatcher/shift/deposit
  - src/views/DispatcherShiftClose.jsx:390 via apiClient.request call=/api/dispatcher/shift/deposit
  - src/views/DispatcherShiftClose.jsx:417 via apiClient.request call=/api/dispatcher/shift/deposit

### POST /api/dispatcher/shift/close
- file: `server/dispatcher-shift.mjs`:316
- mount: `/api/dispatcher/shift`
- route: `/close`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, business_day, amount, is_closed, source, closed_at, closed_by]
- side_effects: db_writes=[]
- frontend_consumers:
  - src/views/DispatcherShiftClose.jsx:453 via apiClient.request call=/api/dispatcher/shift/close

## owner.mjs (24)

### GET /api/owner/money/summary
- file: `server/owner.mjs`:365
- mount: `/api/owner`
- route: `/money/summary`
- role_access: `unknown`
- input_contract: params=[] query=[from, to, preset] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/pending-by-day
- file: `server/owner.mjs`:1111
- mount: `/api/owner`
- route: `/money/pending-by-day`
- role_access: `unknown`
- input_contract: params=[] query=[preset] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/pending-by-day/:day
- file: `server/owner.mjs`:1112
- mount: `/api/owner`
- route: `/money/pending-by-day/:day`
- role_access: `unknown`
- input_contract: params=[] query=[preset] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-days
- file: `server/owner.mjs`:1118
- mount: `/api/owner`
- route: `/money/compare-days`
- role_access: `unknown`
- input_contract: params=[] query=[preset] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-periods
- file: `server/owner.mjs`:1322
- mount: `/api/owner`
- route: `/money/compare-periods`
- role_access: `unknown`
- input_contract: params=[] query=[fromA, toA, presetA, fromB, toB, presetB] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-periods-daily
- file: `server/owner.mjs`:1559
- mount: `/api/owner`
- route: `/money/compare-periods-daily`
- role_access: `unknown`
- input_contract: params=[] query=[fromA, toA, fromB, toB, mode, boatId] body=[]
- output_contract: json_keys=[ok, data, periodA, from, to, days, periodB, points, meta, warnings]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-boat-daily
- file: `server/owner.mjs`:1664
- mount: `/api/owner`
- route: `/money/compare-boat-daily`
- role_access: `unknown`
- input_contract: params=[] query=[boatId, fromA, toA, fromB, toB, mode, sellerId] body=[]
- output_contract: json_keys=[ok, data, periodA, from, to, days, periodB, points, meta]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-seller-daily
- file: `server/owner.mjs`:1784
- mount: `/api/owner`
- route: `/money/compare-seller-daily`
- role_access: `unknown`
- input_contract: params=[] query=[sellerId, fromA, toA, fromB, toB, mode, limit, sort] body=[]
- output_contract: json_keys=[ok, data, periodA, from, to, days, periodB, points, meta]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-boats
- file: `server/owner.mjs`:1902
- mount: `/api/owner`
- route: `/money/compare-boats`
- role_access: `unknown`
- input_contract: params=[] query=[fromA, toA, fromB, toB, limit, sort] body=[]
- output_contract: json_keys=[ok, data, periodA, from, to, periodB, rows, total, meta]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/money/compare-sellers
- file: `server/owner.mjs`:2032
- mount: `/api/owner`
- route: `/money/compare-sellers`
- role_access: `unknown`
- input_contract: params=[] query=[fromA, toA, fromB, toB, limit, sort, day] body=[]
- output_contract: json_keys=[ok, data, periodA, from, to, periodB, rows, total, meta]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/motivation/day
- file: `server/owner.mjs`:2160
- mount: `/api/owner`
- route: `/motivation/day`
- role_access: `unknown`
- input_contract: params=[] query=[day, week] body=[]
- output_contract: json_keys=[ok, data, meta, warnings]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/motivation/weekly
- file: `server/owner.mjs`:2187
- mount: `/api/owner`
- route: `/motivation/weekly`
- role_access: `unknown`
- input_contract: params=[] query=[week] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/motivation/season
- file: `server/owner.mjs`:2497
- mount: `/api/owner`
- route: `/motivation/season`
- role_access: `unknown`
- input_contract: params=[] query=[season_id] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/invariants
- file: `server/owner.mjs`:2781
- mount: `/api/owner`
- route: `/invariants`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/boats
- file: `server/owner.mjs`:3067
- mount: `/api/owner`
- route: `/boats`
- role_access: `unknown`
- input_contract: params=[] query=[preset] body=[]
- output_contract: json_keys=[ok, data, range, null, from, to, totals, meta]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/owner/sellers/list
- file: `server/owner.mjs`:3198
- mount: `/api/owner`
- route: `/sellers/list`
- role_access: `unknown`
- input_contract: params=[] query=[preset] body=[]
- output_contract: json_keys=[ok, data]
- side_effects: db_writes=[]
- frontend_consumers:
  - src/views/OwnerSettingsView.jsx:287 via apiClient.request call=/api/owner/sellers/list

### GET /api/owner/sellers
- file: `server/owner.mjs`:3229
- mount: `/api/owner`
- route: `/sellers`
- role_access: `unknown`
- input_contract: params=[] query=[preset] body=[]
- output_contract: json_keys=[ok, data, range, null, from, to, meta]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### PUT /api/owner/sellers/:id/zone
- file: `server/owner.mjs`:3376
- mount: `/api/owner`
- route: `/sellers/:id/zone`
- role_access: `unknown`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[ok, data, seller_id, seller_name, zone]
- side_effects: db_writes=[UPDATE seller; UPDATE zone; UPDATE users]
- frontend_consumers: none_detected

### GET /api/owner/money/collected-today-by-tripday
- file: `server/owner.mjs`:3435
- mount: `/api/owner`
- route: `/money/collected-today-by-tripday`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, data, collected_day, by_trip_day, today, revenue, cash, card, tomorrow, day2, meta, warnings]
- side_effects: db_writes=[UPDATE zone]
- frontend_consumers: none_detected

### GET /api/owner/manual/day
- file: `server/owner.mjs`:3636
- mount: `/api/owner`
- route: `/manual/day`
- role_access: `unknown`
- input_contract: params=[] query=[date, day] body=[]
- output_contract: json_keys=[ok, period, locked, lockedAt, drafts, id, author, savedAt]
- side_effects: db_writes=[]
- frontend_consumers:
  - src/components/owner/OwnerLoadView.jsx:186 via apiClient.request call=/api/owner/manual/day

### PUT /api/owner/manual/day
- file: `server/owner.mjs`:3737
- mount: `/api/owner`
- route: `/manual/day`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, id, savedAt]
- side_effects: db_writes=[UPDATE manual_batches; INSERT INTO manual_batches; INSERT INTO manual_days; UPDATE SET; DELETE FROM manual_boat_stats; DELETE FROM manual_seller_stats; INSERT INTO manual_boat_stats]
- frontend_consumers:
  - src/components/owner/OwnerLoadView.jsx:186 via apiClient.request call=/api/owner/manual/day

### POST /api/owner/manual/lock
- file: `server/owner.mjs`:3816
- mount: `/api/owner`
- route: `/manual/lock`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, id, savedAt, locked, lockedAt, lockedBy, totals, forecast]
- side_effects: db_writes=[UPDATE manual_batches; INSERT INTO manual_days; UPDATE SET; DELETE FROM manual_boat_stats; DELETE FROM manual_seller_stats; INSERT INTO manual_boat_stats; INSERT INTO manual_seller_stats]
- frontend_consumers:
  - src/components/owner/OwnerLoadView.jsx:212 via apiClient.request call=/api/owner/manual/lock

### GET /api/owner/settings/full
- file: `server/owner.mjs`:4197
- mount: `/api/owner`
- route: `/settings/full`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, data]
- side_effects: db_writes=[UPDATE owner_settings]
- frontend_consumers:
  - src/views/OwnerMotivationView.jsx:125 via apiClient.request call=/api/owner/settings/full
  - src/views/OwnerSettingsView.jsx:105 via apiClient.request call=/api/owner/settings/full
  - src/views/OwnerSettingsView.jsx:265 via apiClient.request call=/api/owner/settings/full

### PUT /api/owner/settings/full
- file: `server/owner.mjs`:4223
- mount: `/api/owner`
- route: `/settings/full`
- role_access: `unknown`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, data]
- side_effects: db_writes=[UPDATE owner_settings]
- frontend_consumers:
  - src/views/OwnerMotivationView.jsx:125 via apiClient.request call=/api/owner/settings/full
  - src/views/OwnerSettingsView.jsx:105 via apiClient.request call=/api/owner/settings/full
  - src/views/OwnerSettingsView.jsx:265 via apiClient.request call=/api/owner/settings/full

## schedule-template-items.mjs (7)

### GET /api/selling/schedule-template-items
- file: `server/schedule-template-items.mjs`:66
- mount: `/api/selling`
- route: `/schedule-template-items`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[name, boat_id, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[]
- frontend_consumers:
  - src\components\dispatcher\ScheduleTemplates.jsx:52 via apiClient.getScheduleTemplateItems call=/api/selling/schedule-template-items
  - src\components\dispatcher\ScheduleTemplates.jsx:230 via apiClient.createScheduleTemplateItem call=/api/selling/schedule-template-items

### GET /api/selling/schedule-template-items/:id
- file: `server/schedule-template-items.mjs`:93
- mount: `/api/selling`
- route: `/schedule-template-items/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[name, boat_id, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### POST /api/selling/schedule-template-items
- file: `server/schedule-template-items.mjs`:127
- mount: `/api/selling`
- route: `/schedule-template-items`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[name, boat_id, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active]
- output_contract: json_keys=[ok]
- side_effects: db_writes=[INSERT INTO schedule_template_items]
- frontend_consumers:
  - src\components\dispatcher\ScheduleTemplates.jsx:52 via apiClient.getScheduleTemplateItems call=/api/selling/schedule-template-items
  - src\components\dispatcher\ScheduleTemplates.jsx:230 via apiClient.createScheduleTemplateItem call=/api/selling/schedule-template-items

### PATCH /api/selling/schedule-template-items/:id
- file: `server/schedule-template-items.mjs`:287
- mount: `/api/selling`
- route: `/schedule-template-items/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[name, boat_id, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE a; UPDATE query]
- frontend_consumers: none_detected

### DELETE /api/selling/schedule-template-items/:id
- file: `server/schedule-template-items.mjs`:469
- mount: `/api/selling`
- route: `/schedule-template-items/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[deleteFutureTrips] body=[]
- output_contract: json_keys=[ok, item, message, id, deletedFutureTrips, futureTripsDeleted, changes, generated, skipped]
- side_effects: db_writes=[DELETE FROM generated_slots; DELETE FROM schedule_template_items]
- frontend_consumers: none_detected

### POST /api/selling/schedule-template-items/generate
- file: `server/schedule-template-items.mjs`:548
- mount: `/api/selling`
- route: `/schedule-template-items/generate`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[ok, message, generated, skipped]
- side_effects: db_writes=[INSERT INTO generated_slots]
- frontend_consumers: none_detected

### DELETE /api/selling/trips-for-deleted-boats
- file: `server/schedule-template-items.mjs`:763
- mount: `/api/selling`
- route: `/trips-for-deleted-boats`
- role_access: `admin(+owner for requireAdminRole)`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[ok, message, deleted, deleted_generated, deleted_manual]
- side_effects: db_writes=[DELETE FROM generated_slots; DELETE FROM boat_slots]
- frontend_consumers: none_detected

## schedule-templates.mjs (9)

### GET UNMOUNTED/schedule-templates
- file: `server/schedule-templates.mjs`:49
- mount: `UNMOUNTED`
- route: `/schedule-templates`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO schedule_templates]
- frontend_consumers: none_detected

### GET UNMOUNTED/schedule-templates/:id
- file: `server/schedule-templates.mjs`:69
- mount: `UNMOUNTED`
- route: `/schedule-templates/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[auto_generate, weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO schedule_templates]
- frontend_consumers: none_detected

### POST UNMOUNTED/schedule-templates
- file: `server/schedule-templates.mjs`:99
- mount: `UNMOUNTED`
- route: `/schedule-templates`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[auto_generate, weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO schedule_templates]
- frontend_consumers: none_detected

### POST UNMOUNTED/schedule-templates/:id/generate
- file: `server/schedule-templates.mjs`:306
- mount: `UNMOUNTED`
- route: `/schedule-templates/:id/generate`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[fromDate, days, weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active]
- output_contract: json_keys=[ok, message, created, skipped, reasons, already_exists, generated_slots, skipped_slots]
- side_effects: db_writes=[UPDATE a; UPDATE query]
- frontend_consumers: none_detected

### PATCH UNMOUNTED/schedule-templates/:id
- file: `server/schedule-templates.mjs`:388
- mount: `UNMOUNTED`
- route: `/schedule-templates/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE a; UPDATE query; UPDATE schedule_templates]
- frontend_consumers: none_detected

### DELETE UNMOUNTED/schedule-templates/:id
- file: `server/schedule-templates.mjs`:542
- mount: `UNMOUNTED`
- route: `/schedule-templates/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[date_from, date_to]
- output_contract: json_keys=[message, id, generated, skipped, generated_slots, skipped_slots]
- side_effects: db_writes=[DELETE FROM schedule_templates; INSERT INTO generated_slots]
- frontend_consumers: none_detected

### POST UNMOUNTED/schedule-templates/generate
- file: `server/schedule-templates.mjs`:572
- mount: `UNMOUNTED`
- route: `/schedule-templates/generate`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[date_from, date_to]
- output_contract: json_keys=[message, id, generated, skipped, generated_slots, skipped_slots]
- side_effects: db_writes=[INSERT INTO generated_slots]
- frontend_consumers: none_detected

### GET UNMOUNTED/generated-slots
- file: `server/schedule-templates.mjs`:686
- mount: `UNMOUNTED`
- route: `/generated-slots`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET UNMOUNTED/generated-slots/active
- file: `server/schedule-templates.mjs`:728
- mount: `UNMOUNTED`
- route: `/generated-slots/active`
- role_access: `authenticated`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

## selling.mjs (34)

### GET /api/selling/boats
- file: `server/selling.mjs`:525
- mount: `/api/selling`
- route: `/boats`
- role_access: `seller|dispatcher`
- input_contract: params=[type] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE boat_slots]
- frontend_consumers:
  - src\components\admin\BoatManagement.jsx:56 via apiClient.getBoats call=/api/selling/boats

### GET /api/selling/boats/:type/slots
- file: `server/selling.mjs`:545
- mount: `/api/selling`
- route: `/boats/:type/slots`
- role_access: `seller|dispatcher`
- input_contract: params=[type] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### POST /api/selling/presales
- file: `server/selling.mjs`:723
- mount: `/api/selling`
- route: `/presales`
- role_access: `seller|dispatcher`
- input_contract: params=[type] query=[] body=[tickets, slotUid, customerName, customerPhone, numberOfSeats, prepaymentAmount, prepaymentComment, sellerId]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers:
  - src\components\dispatcher\QuickSaleForm.jsx:285 via apiClient.createPresale call=/api/selling/presales
  - src\views\SellerView.jsx:166 via apiClient.createPresale call=/api/selling/presales
  - src\components\dispatcher\PresaleListView.jsx:79 via apiClient.getPresales call=/api/selling/presales
  - src\components\seller\SalesHistory.jsx:25 via apiClient.getPresales call=/api/selling/presales

### GET /api/selling/presales
- file: `server/selling.mjs`:1824
- mount: `/api/selling`
- route: `/presales`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers:
  - src\components\dispatcher\QuickSaleForm.jsx:285 via apiClient.createPresale call=/api/selling/presales
  - src\views\SellerView.jsx:166 via apiClient.createPresale call=/api/selling/presales
  - src\components\dispatcher\PresaleListView.jsx:79 via apiClient.getPresales call=/api/selling/presales
  - src\components\seller\SalesHistory.jsx:25 via apiClient.getPresales call=/api/selling/presales

### GET /api/selling/presales/cancelled-trip-pending
- file: `server/selling.mjs`:1868
- mount: `/api/selling`
- route: `/presales/cancelled-trip-pending`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE zone; UPDATE users]
- frontend_consumers: none_detected

### GET /api/selling/presales/:id
- file: `server/selling.mjs`:1917
- mount: `/api/selling`
- route: `/presales/:id`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[boat_id, time, capacity, duration_minutes, active, price_adult, price_child, price_teen]
- output_contract: json_keys=[ok, data, seller_id, seller_name, zone]
- side_effects: db_writes=[UPDATE zone; UPDATE users]
- frontend_consumers: none_detected

### PUT /api/selling/dispatcher/sellers/:id/zone
- file: `server/selling.mjs`:1975
- mount: `/api/selling`
- route: `/dispatcher/sellers/:id/zone`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[boat_id, time, capacity, duration_minutes, active, price_adult, price_child, price_teen]
- output_contract: json_keys=[ok, data, seller_id, seller_name, zone]
- side_effects: db_writes=[UPDATE zone; UPDATE users]
- frontend_consumers: none_detected

### POST /api/selling/dispatcher/slots
- file: `server/selling.mjs`:2032
- mount: `/api/selling`
- route: `/dispatcher/slots`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[boat_id, time, capacity, duration_minutes, active, price_adult, price_child, price_teen, price]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE zone; INSERT INTO boat_slots; UPDATE a]
- frontend_consumers:
  - src\components\dispatcher\TicketSellingView.jsx:95 via apiClient.getTrips call=/api/selling/dispatcher/slots
  - src\components\dispatcher\PassengerList.jsx:187 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\PassengerList.jsx:326 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagement.jsx:168 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagementWithSchedule.jsx:127 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\TripListView.jsx:97 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagement.jsx:337 via apiClient.createDispatcherSlot call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagementWithSchedule.jsx:303 via apiClient.createDispatcherSlot call=/api/selling/dispatcher/slots

### PATCH /api/selling/dispatcher/slots/:id
- file: `server/selling.mjs`:2144
- mount: `/api/selling`
- route: `/dispatcher/slots/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[time, price, capacity, duration_minutes, active, price_adult, price_child, price_teen]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE a; UPDATE const]
- frontend_consumers: none_detected

### PATCH /api/selling/dispatcher/slots/:id/active
- file: `server/selling.mjs`:2383
- mount: `/api/selling`
- route: `/dispatcher/slots/:id/active`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[active]
- output_contract: json_keys=[debug, endpoint, updatedPresales]
- side_effects: db_writes=[UPDATE const; UPDATE presales; UPDATE slot; UPDATE all; UPDATE the; UPDATE boat_slots]
- frontend_consumers: none_detected

### DELETE /api/selling/dispatcher/slots/:id
- file: `server/selling.mjs`:2474
- mount: `/api/selling`
- route: `/dispatcher/slots/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[ok, mode, message, slot, id, data, items]
- side_effects: db_writes=[UPDATE the; UPDATE boat_slots; DELETE FROM boat_slots]
- frontend_consumers: none_detected

### GET /api/selling/dispatcher/boats
- file: `server/selling.mjs`:2551
- mount: `/api/selling`
- route: `/dispatcher/boats`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id, slotId] query=[] body=[]
- output_contract: json_keys=[ok, data, items]
- side_effects: db_writes=[]
- frontend_consumers:
  - src\components\dispatcher\ScheduleTemplates.jsx:53 via apiClient.getAllDispatcherBoats call=/api/selling/dispatcher/boats
  - src\components\dispatcher\SlotManagement.jsx:169 via apiClient.getAllDispatcherBoats call=/api/selling/dispatcher/boats
  - src\components\dispatcher\SlotManagementWithSchedule.jsx:128 via apiClient.getAllDispatcherBoats call=/api/selling/dispatcher/boats

### GET /api/selling/dispatcher/sellers
- file: `server/selling.mjs`:2562
- mount: `/api/selling`
- route: `/dispatcher/sellers`
- role_access: `seller|dispatcher`
- input_contract: params=[slotId] query=[] body=[]
- output_contract: json_keys=[ok, data, items]
- side_effects: db_writes=[]
- frontend_consumers:
  - src/components/dispatcher/QuickSaleForm.jsx:132 via apiClient.request call=/api/selling/dispatcher/sellers

### GET /api/selling/dispatcher/slots
- file: `server/selling.mjs`:2584
- mount: `/api/selling`
- route: `/dispatcher/slots`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[slotId] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers:
  - src\components\dispatcher\TicketSellingView.jsx:95 via apiClient.getTrips call=/api/selling/dispatcher/slots
  - src\components\dispatcher\PassengerList.jsx:187 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\PassengerList.jsx:326 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagement.jsx:168 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagementWithSchedule.jsx:127 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\TripListView.jsx:97 via apiClient.getAllDispatcherSlots call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagement.jsx:337 via apiClient.createDispatcherSlot call=/api/selling/dispatcher/slots
  - src\components\dispatcher\SlotManagementWithSchedule.jsx:303 via apiClient.createDispatcherSlot call=/api/selling/dispatcher/slots

### GET /api/selling/dispatcher/slots/:slotId/tickets
- file: `server/selling.mjs`:2631
- mount: `/api/selling`
- route: `/dispatcher/slots/:slotId/tickets`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[slotId, id] query=[] body=[additionalPayment]
- output_contract: json_keys=[ok, data, slot_id, slot_uid]
- side_effects: db_writes=[UPDATE presale; UPDATE payment]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/payment
- file: `server/selling.mjs`:2737
- mount: `/api/selling`
- route: `/presales/:id/payment`
- role_access: `seller|dispatcher`
- input_contract: params=[slotId, id] query=[] body=[additionalPayment]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE payment; UPDATE prepayment; UPDATE presales]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/accept-payment
- file: `server/selling.mjs`:2812
- mount: `/api/selling`
- route: `/presales/:id/accept-payment`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presales]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/cancel
- file: `server/selling.mjs`:3076
- mount: `/api/selling`
- route: `/presales/:id/cancel`
- role_access: `seller|dispatcher`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presales; INSERT INTO money_ledger; UPDATE tickets; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/move
- file: `server/selling.mjs`:3233
- mount: `/api/selling`
- route: `/presales/:id/move`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[target_slot_id]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; INSERT INTO boat_slots; UPDATE the; UPDATE presales]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/seats
- file: `server/selling.mjs`:3457
- mount: `/api/selling`
- route: `/presales/:id/seats`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[number_of_seats, comment]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE the; UPDATE presales; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/used
- file: `server/selling.mjs`:3581
- mount: `/api/selling`
- route: `/presales/:id/used`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE the; UPDATE presales; UPDATE presale; UPDATE tickets; UPDATE all]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/refund
- file: `server/selling.mjs`:3655
- mount: `/api/selling`
- route: `/presales/:id/refund`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presale; UPDATE tickets; UPDATE the; UPDATE presales; UPDATE all; UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/delete
- file: `server/selling.mjs`:3785
- mount: `/api/selling`
- route: `/presales/:id/delete`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[UPDATE presales; INSERT INTO money_ledger; UPDATE tickets; UPDATE sales_transactions_canonical; UPDATE boat_slots; UPDATE generated_slots]
- frontend_consumers: none_detected

### GET /api/selling/presales/:id/tickets
- file: `server/selling.mjs`:3955
- mount: `/api/selling`
- route: `/presales/:id/tickets`
- role_access: `seller|dispatcher`
- input_contract: params=[id, slotId, ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE sales_transactions_canonical]
- frontend_consumers: none_detected

### GET /api/selling/slots/:slotId/tickets
- file: `server/selling.mjs`:3980
- mount: `/api/selling`
- route: `/slots/:slotId/tickets`
- role_access: `seller|dispatcher`
- input_contract: params=[id, slotId, ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE sales_transactions_canonical; UPDATE generated_slots; UPDATE boat_slots]
- frontend_consumers: none_detected

### PATCH /api/selling/tickets/:ticketId/used
- file: `server/selling.mjs`:4025
- mount: `/api/selling`
- route: `/tickets/:ticketId/used`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[slotId, ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE sales_transactions_canonical; UPDATE generated_slots; UPDATE boat_slots; UPDATE presales]
- frontend_consumers: none_detected

### PATCH /api/selling/tickets/:ticketId/refund
- file: `server/selling.mjs`:4060
- mount: `/api/selling`
- route: `/tickets/:ticketId/refund`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE sales_transactions_canonical; UPDATE generated_slots; UPDATE boat_slots; UPDATE presales]
- frontend_consumers: none_detected

### PATCH /api/selling/tickets/:ticketId/delete
- file: `server/selling.mjs`:4179
- mount: `/api/selling`
- route: `/tickets/:ticketId/delete`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[ticketId] query=[] body=[]
- output_contract: json_keys=[success, ticket]
- side_effects: db_writes=[UPDATE tickets; UPDATE sales_transactions_canonical; UPDATE generated_slots; UPDATE boat_slots; INSERT INTO money_ledger]
- frontend_consumers: none_detected

### POST /api/selling/tickets/:ticketId/transfer
- file: `server/selling.mjs`:4627
- mount: `/api/selling`
- route: `/tickets/:ticketId/transfer`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[success]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### PATCH /api/selling/tickets/:ticketId/transfer
- file: `server/selling.mjs`:4628
- mount: `/api/selling`
- route: `/tickets/:ticketId/transfer`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[success]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### GET /api/selling/transfer-options
- file: `server/selling.mjs`:4633
- mount: `/api/selling`
- route: `/transfer-options`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[] query=[] body=[]
- output_contract: json_keys=[]
- side_effects: db_writes=[]
- frontend_consumers: none_detected

### POST /api/selling/presales/:id/transfer
- file: `server/selling.mjs`:5164
- mount: `/api/selling`
- route: `/presales/:id/transfer`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success]
- side_effects: db_writes=[UPDATE presales]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/transfer
- file: `server/selling.mjs`:5198
- mount: `/api/selling`
- route: `/presales/:id/transfer`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success]
- side_effects: db_writes=[UPDATE presales; INSERT INTO money_ledger]
- frontend_consumers: none_detected

### PATCH /api/selling/presales/:id/cancel-trip-pending
- file: `server/selling.mjs`:5232
- mount: `/api/selling`
- route: `/presales/:id/cancel-trip-pending`
- role_access: `seller|dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[success, message]
- side_effects: db_writes=[UPDATE presales; INSERT INTO money_ledger; UPDATE already]
- frontend_consumers: none_detected

## trip-templates.mjs (5)

### GET /api/selling/templates
- file: `server/trip-templates.mjs`:49
- mount: `/api/selling`
- route: `/templates`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[product_type, time, duration_minutes, capacity, price_adult, price_child, price_teen, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO trip_templates; UPDATE a]
- frontend_consumers: none_detected

### GET /api/selling/templates/:id
- file: `server/trip-templates.mjs`:67
- mount: `/api/selling`
- route: `/templates/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[product_type, time, duration_minutes, capacity, price_adult, price_child, price_teen, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO trip_templates; UPDATE a; UPDATE query]
- frontend_consumers: none_detected

### POST /api/selling/templates
- file: `server/trip-templates.mjs`:95
- mount: `/api/selling`
- route: `/templates`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[product_type, time, duration_minutes, capacity, price_adult, price_child, price_teen, is_active]
- output_contract: json_keys=[]
- side_effects: db_writes=[INSERT INTO trip_templates; UPDATE a; UPDATE query]
- frontend_consumers: none_detected

### PATCH /api/selling/templates/:id
- file: `server/trip-templates.mjs`:177
- mount: `/api/selling`
- route: `/templates/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[time, duration_minutes, capacity, price_adult, price_child, price_teen, is_active]
- output_contract: json_keys=[message, id]
- side_effects: db_writes=[UPDATE a; UPDATE query; UPDATE trip_templates; DELETE FROM trip_templates]
- frontend_consumers: none_detected

### DELETE /api/selling/templates/:id
- file: `server/trip-templates.mjs`:290
- mount: `/api/selling`
- route: `/templates/:id`
- role_access: `dispatcher|owner|admin`
- input_contract: params=[id] query=[] body=[]
- output_contract: json_keys=[message, id]
- side_effects: db_writes=[DELETE FROM trip_templates]
- frontend_consumers: none_detected

