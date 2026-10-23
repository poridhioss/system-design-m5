#!/usr/bin/env bash
# HTTP test collection for the users API.
# Usage: ./requests.sh            (defaults to http://localhost:8000)
#        BASE=http://HOST:PORT ./requests.sh

BASE=${BASE:-http://localhost:8000}

# req METHOD PATH [JSON_BODY]: print the request, the response body and the status code
req() {
  echo "### $1 $2 ${3:-}"
  if [ -n "${3:-}" ]; then
    curl -sS -X "$1" "$BASE$2" -H 'Content-Type: application/json' -d "$3" -w '\nHTTP %{http_code}\n'
  else
    curl -sS -X "$1" "$BASE$2" -w '\nHTTP %{http_code}\n'
  fi
  echo
}

# Create a user and remember its id for the requests below
echo "### POST /users (create)"
CREATED=$(curl -sS -X POST "$BASE/users" -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}')
ID=$(echo "$CREATED" | jq -r .id 2>/dev/null)

# Stop here if the create failed: every request below needs a real id.
if ! [[ "$ID" =~ ^[0-9]+$ ]]; then
  echo "could not create the test user. Is the API running at $BASE? The response was:"
  echo "$CREATED" | head -c 300
  echo
  exit 1
fi
echo "created user id: $ID"
echo

req GET    "/users"
req GET    "/users/$ID"
req PUT    "/users/$ID" '{"name":"Ada King","email":"ada.king@example.com"}'
req POST   "/users"     '{"name":"Copy Cat","email":"ada.king@example.com"}'
req POST   "/users"     '{"name":"","email":"not-an-email"}'
req POST   "/users"     '{"name": "Broken JSON"'
req GET    "/users/abc"
req DELETE "/users/$ID"
req GET    "/users/$ID"
