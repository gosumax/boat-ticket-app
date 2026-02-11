-- Migration: add trip_date to boat_slots (date of trip, YYYY-MM-DD)
-- Run once in SQLite.

ALTER TABLE boat_slots ADD COLUMN trip_date TEXT;

-- Optional backfill if you already have a date-like column in boat_slots:
-- UPDATE boat_slots SET trip_date = day WHERE trip_date IS NULL;
-- UPDATE boat_slots SET trip_date = date WHERE trip_date IS NULL;
