# Security

Report suspected vulnerabilities privately to the repository owner rather than opening a public
issue with exploit details. Include the affected version, impact, and a minimal reproduction that
does not contain production credentials or community chat.

Keep the Discord token, webhook URL, RCON password, `.env`, SQLite database, backups, and Conan logs
out of source control. RCON must remain on loopback or a restricted private network. Rotate any
credential immediately if it may have been exposed.
