ALTER TABLE trip_planner_users
  ADD COLUMN IF NOT EXISTS employment_status text NOT NULL DEFAULT 'active';

ALTER TABLE trip_planner_trips
  ADD COLUMN IF NOT EXISTS clients_to_visit integer;

ALTER TABLE trip_planner_chat_messages
  ADD COLUMN IF NOT EXISTS sender_time_zone text,
  ADD COLUMN IF NOT EXISTS client_sent_at timestamptz;

CREATE TABLE IF NOT EXISTS trip_planner_login_sessions (
  id varchar PRIMARY KEY,
  user_id varchar NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  session_id varchar NOT NULL,
  login_at timestamptz NOT NULL DEFAULT now(),
  logout_at timestamptz,
  duration_seconds integer,
  end_reason text
);

CREATE TABLE IF NOT EXISTS trip_planner_credential_broadcasts (
  id varchar PRIMARY KEY,
  status text NOT NULL,
  total integer NOT NULL,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
