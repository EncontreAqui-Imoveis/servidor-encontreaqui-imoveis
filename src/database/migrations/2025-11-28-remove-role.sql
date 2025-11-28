-- Remove role column gracefully if it exists (for compatibility with legacy schema)
ALTER TABLE users DROP COLUMN IF EXISTS role;
