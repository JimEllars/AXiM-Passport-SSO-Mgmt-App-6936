CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT,
  name TEXT NOT NULL,
  owner_address TEXT,
  redirect_uris TEXT,
  allowed_origins TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  did TEXT PRIMARY KEY,
  primary_wallet TEXT,
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS linked_identities (
  id TEXT PRIMARY KEY,
  user_did TEXT,
  provider TEXT,
  identifier TEXT,
  verified_at DATETIME,
  FOREIGN KEY (user_did) REFERENCES users(did)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_did TEXT,
  app_id TEXT,
  event TEXT,
  ip_country TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_did) REFERENCES users(did)
);
