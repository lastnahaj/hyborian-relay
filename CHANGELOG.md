# 1.0.0 (Beta)

Initial public beta release of Hyborian Relay.

## Added

- Two-way Discord and Conan Exiles chat relay
- Enhanced Pippi server-chat transport detection
- Conan RCON connection management and bounded command priority
- Safe Global-chat filtering, mention protection, and chat echo prevention
- Player presence, join, leave, session, and server-state tracking
- Player death tracking with confirmed player, creature, non-player-character, and environmental
  attribution
- Death-event persistence and duplicate suppression
- Discord `/players` and `/status` commands and optional persistent status message
- SQLite migrations and restart recovery
- Per-user and global chat rate limiting
- Automatic RCON and Discord reconnection handling
- Conan log truncation and rotation support
- Health endpoints and installation diagnostics
- systemd and Docker deployment
- Change-aware GitHub validation and automated tests
