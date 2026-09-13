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
