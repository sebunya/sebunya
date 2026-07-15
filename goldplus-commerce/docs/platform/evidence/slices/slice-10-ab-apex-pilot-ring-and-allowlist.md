# Slice 10-AB APEX pilot ring and allowlist

Ring model is implemented and fail-closed: Ring 0 internal UAT writes; Ring 1 requires verified identity plus a configured hashed allowlist; Ring 2 is public read-only; Ring 3 is blocked unless explicitly verified and allowlisted.

The production environment has no safe Ring 1 identity configured. No private identity was fabricated, printed or committed. The allowlist parser accepts only non-secret identity hashes and emits masked evidence. Decision therefore remains save-blocked while the Ring 1 guard is ready.
