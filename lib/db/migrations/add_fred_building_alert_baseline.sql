-- A cold-start failure must not create an outage. The alert evaluator records
-- that each target has first supplied a fresh healthy observation.
ALTER TABLE fred_building_alert_states
  ADD COLUMN IF NOT EXISTS baseline_established BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing active incidents necessarily crossed an operator-approved outage
-- path and must remain recoverable after this forward-compatible migration.
UPDATE fred_building_alert_states
SET baseline_established = TRUE
WHERE phase = 'outage'
  AND baseline_established = FALSE;
