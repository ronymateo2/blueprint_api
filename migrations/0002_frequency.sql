ALTER TABLE habits ADD COLUMN frequency_type TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE habits ADD COLUMN frequency_config TEXT NOT NULL DEFAULT '{}';
