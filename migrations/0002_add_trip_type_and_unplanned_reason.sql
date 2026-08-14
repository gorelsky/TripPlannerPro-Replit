ALTER TABLE "trip_planner_trips"
  ADD COLUMN IF NOT EXISTS "trip_type" text NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS "unplanned_reason" text;
