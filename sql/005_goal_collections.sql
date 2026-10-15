-- Keep goal collections in the same account state and snapshot transaction.
ALTER TABLE user_app_state ADD COLUMN collections JSON NULL;
ALTER TABLE user_tasks ADD COLUMN collection_id VARCHAR(128) COLLATE utf8mb4_bin NULL;
