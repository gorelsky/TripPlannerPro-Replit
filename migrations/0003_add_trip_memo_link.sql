ALTER TABLE trip_planner_trips
  ADD COLUMN IF NOT EXISTS source_trip_id varchar,
  ADD COLUMN IF NOT EXISTS memo_type text;
