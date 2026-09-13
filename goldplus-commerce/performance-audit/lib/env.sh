# Shared .env loader for the shell runners. The PROCESS ENVIRONMENT WINS over
# .env (the container runner sets PERF_AUDIT_DATA_DIR=/data; a .env written for
# the host must not redirect the container's writes into its own ephemeral
# filesystem — that is exactly what happened on the first smoke run).
#   source "$HERE/lib/env.sh"; load_dotenv "$HERE/.env"
load_dotenv() {
  local f="${1:-.env}" line k v
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in ''|'#'*) continue;; esac
    case "$line" in *=*) ;; *) continue;; esac
    k="${line%%=*}"; k="${k#export }"; k="${k%"${k##*[![:space:]]}"}"
    v="${line#*=}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}";; \'*\') v="${v#\'}"; v="${v%\'}";; esac
    [ -n "$k" ] || continue
    if [ -z "${!k+x}" ]; then export "$k=$v"; fi
  done < "$f"
}

# Admin-managed settings written by the GoldPlus API into the data dir:
#   settings/secrets.env (credentials) and settings/config.overrides.json (env part).
# They OVERRIDE performance-audit/.env but never the process environment, so the
# variables that were set before load_dotenv ran keep their values.
load_admin_settings() { # <data-dir> <space-separated names that came from the process env>
  local d="$1" pre=" $2 " line k v
  [ -d "$d/settings" ] || return 0
  { [ -f "$d/settings/secrets.env" ] && cat "$d/settings/secrets.env"; \
    [ -f "$d/settings/config.overrides.json" ] && python3 -c 'import json,sys
try:
    e=json.load(open(sys.argv[1])).get("env",{})
except Exception: e={}
for k,v in e.items():
    if isinstance(v,str) and k.replace("_","").isalnum(): print(f"{k}={v}")' "$d/settings/config.overrides.json"; } 2>/dev/null | while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue;; *=*) ;; *) continue;; esac
    printf '%s\n' "$line"
  done > "$d/settings/.merged.$$" 2>/dev/null || true
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}";; \'*\') v="${v#\'}"; v="${v%\'}";; esac
    case "$pre" in *" $k "*) continue;; esac  # process env wins
    [ -n "$k" ] && export "$k=$v"
  done < "$d/settings/.merged.$$"
  rm -f "$d/settings/.merged.$$"
}
