-- Preserve existing school dates and wall-clock times. DATE columns cannot store
-- edited hours; promote only that legacy shape, keeping its existing midnight.
SELECT pg_advisory_xact_lock(hashtext('harmony:calendar-school-time:v1'));
CREATE TABLE IF NOT EXISTS school_events (
 id SERIAL PRIMARY KEY,title VARCHAR(255) NOT NULL,description TEXT,
 start_date TIMESTAMP NOT NULL,end_date TIMESTAMP,event_type VARCHAR(50) NOT NULL,
 target_audience VARCHAR(50) NOT NULL,grade_id INTEGER REFERENCES grades(id),
 class_id INTEGER REFERENCES classes(id),parent_visible BOOLEAN NOT NULL DEFAULT false,
 created_by INTEGER REFERENCES users(id),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,is_active BOOLEAN DEFAULT true
);
DO $$
DECLARE field text;kind text;
BEGIN
 FOREACH field IN ARRAY ARRAY['start_date','end_date'] LOOP
  SELECT data_type INTO kind FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name='school_events' AND column_name=field;
  IF kind='date' THEN
   EXECUTE format('ALTER TABLE school_events ALTER COLUMN %I TYPE timestamp USING %I::timestamp',field,field);
  ELSIF kind IS NULL OR kind NOT IN ('timestamp without time zone','timestamp with time zone') THEN
   RAISE EXCEPTION 'Unsupported calendar date storage for %',field;
  END IF;
 END LOOP;
END $$;
