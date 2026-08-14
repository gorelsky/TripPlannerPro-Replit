ALTER TABLE "trip_planner_trips"
  ADD COLUMN IF NOT EXISTS "trivio_booking_number" text,
  ADD COLUMN IF NOT EXISTS "trivio_booking_url" text;
