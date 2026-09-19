-- Seed default client credentials and callback URLs for all active ecosystem sister applications
INSERT INTO apps (id, client_id, client_secret_hash, name, owner_address, redirect_uris, allowed_origins)
VALUES
('eco_nexus_001', 'client_nexus_app', 'sec_hash_nexus', 'AXiM Nexus', 'system_seed', '["https://nexus.axim.us.com/callback", "https://nexus.axim.app/callback"]', '["https://nexus.axim.us.com", "https://nexus.axim.app"]'),
('eco_echo_002', 'client_echo_app', 'sec_hash_echo', 'AXiM Echo', 'system_seed', '["https://echo.axim.us.com/callback", "https://echo.axim.app/callback"]', '["https://echo.axim.us.com", "https://echo.axim.app"]'),
('eco_onyx_003', 'client_onyx_app', 'sec_hash_onyx', 'AXiM Onyx', 'system_seed', '["https://onyx.axim.us.com/callback", "https://onyx.axim.app/callback"]', '["https://onyx.axim.us.com", "https://onyx.axim.app"]');
