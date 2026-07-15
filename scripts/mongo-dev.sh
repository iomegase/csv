#!/usr/bin/env bash
# Instance MongoDB dédiée au développement du lecteur CSV.
#
# Volontairement séparée du service brew mongodb-community du port 27017,
# qui héberge d'autres projets et tourne en standalone (donc sans
# transactions). Celle-ci est un replica set à un nœud : les transactions
# exigées par l'activation de template et l'application de facture y
# fonctionnent.

set -euo pipefail

PORT=27018
REPL_SET=rs-lecteur-csv
DATA_DIR="$HOME/.local/share/lecteur-csv/mongodb"
LOG_FILE="$HOME/.local/share/lecteur-csv/mongod.log"
MONGOD=/opt/homebrew/opt/mongodb-community/bin/mongod

is_running() {
  pgrep -f "mongod.*--port $PORT" >/dev/null 2>&1
}

start() {
  if is_running; then
    echo "Déjà démarré sur le port $PORT."
    return 0
  fi

  mkdir -p "$DATA_DIR" "$(dirname "$LOG_FILE")"

  "$MONGOD" \
    --replSet "$REPL_SET" \
    --port "$PORT" \
    --dbpath "$DATA_DIR" \
    --bind_ip 127.0.0.1 \
    --logpath "$LOG_FILE" \
    --logappend \
    --fork

  # Le replica set n'est initié qu'au tout premier démarrage ; ensuite la
  # configuration est déjà dans le dbPath et rs.initiate() échouerait.
  if ! mongosh --quiet --port "$PORT" --eval 'rs.status().ok' >/dev/null 2>&1; then
    mongosh --quiet --port "$PORT" --eval \
      "rs.initiate({_id: '$REPL_SET', members: [{_id: 0, host: '127.0.0.1:$PORT'}]})" >/dev/null
  fi

  # Attendre l'élection : tant que le nœud n'est pas PRIMARY, toute écriture
  # est refusée.
  for _ in $(seq 1 30); do
    if mongosh --quiet --port "$PORT" --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; then
      echo "Prêt : mongodb://127.0.0.1:$PORT/lecteur-csv?replicaSet=$REPL_SET"
      return 0
    fi
    sleep 1
  done

  echo "Démarré mais le nœud n'est jamais devenu PRIMARY. Voir $LOG_FILE" >&2
  return 1
}

stop() {
  if ! is_running; then
    echo "Déjà arrêté."
    return 0
  fi
  mongosh --quiet --port "$PORT" --eval 'db.getSiblingDB("admin").shutdownServer()' >/dev/null 2>&1 || true
  echo "Arrêté."
}

status() {
  if ! is_running; then
    echo "Arrêté. Lancer : npm run mongo:start"
    return 1
  fi
  mongosh --quiet --port "$PORT" --eval \
    'const s = rs.status(); print(`En service — set ${s.set}, membre ${s.members[0].stateStr}`)'
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 1
    ;;
esac
