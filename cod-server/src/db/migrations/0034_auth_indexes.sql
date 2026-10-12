-- Auth performance indexes
-- Better Auth Performance Guide: https://better-auth.com/docs/guides/optimizing-for-performance#database-optimizations
-- Reduces CPU time on auth operations by 1-3ms through faster database queries.

-- Users table: email lookups during sign-in
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sessions table: session validation and user session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Verifications table: email verification lookups
CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier);

-- Accounts table: OAuth account lookups
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- Note: user_scopes.user_id already has an index from migration 0006_user_scopes.sql
