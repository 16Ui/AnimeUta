ALTER TABLE study_card ADD COLUMN fsrs_state INTEGER NOT NULL DEFAULT 0 CHECK (fsrs_state BETWEEN 0 AND 3);
ALTER TABLE study_card ADD COLUMN scheduled_days REAL NOT NULL DEFAULT 0;
ALTER TABLE study_card ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0;

UPDATE study_card
SET fsrs_state = CASE state
    WHEN 'new' THEN 0
    WHEN 'review' THEN 2
    ELSE 1
END,
scheduled_days = CASE WHEN stability > 0 THEN stability ELSE 0 END;

-- The previous scheduler could send a card four days away after its very first
-- successful answer. Bring those cards back into the one-day consolidation
-- window so existing learners benefit from the new scheduler immediately.
UPDATE study_card
SET due_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_reviewed_at, '+1 day'),
    scheduled_days = 1
WHERE repetitions = 1
  AND last_reviewed_at IS NOT NULL
  AND datetime(due_at) > datetime(last_reviewed_at, '+1 day');
