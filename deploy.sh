#!/bin/bash

green='\033[0;32m'
blue='\033[0;34m'
yellow='\033[1;33m'
red='\033[0;31m'
cyan='\033[0;36m'
nc='\033[0m'

colored_echo() {
  local color="$1"
  shift
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo -e "${color}[${timestamp}] $*${nc}"
}

run() {
  "$@" > /dev/null 2>&1
}

no_logs=false
if [ "$1" == "-nl" ]; then
  no_logs=true
fi

colored_echo "$green" "STARTING DEPLOYMENT..."

# Request sudo privileges upfront
colored_echo "$yellow" "Requesting sudo privileges (you may be prompted for your password)..."
if ! sudo -v; then
  colored_echo "$red" "Sudo authentication failed. Aborting deployment."
  exit 1
fi

current_port=$(sudo grep -oP 'proxy_pass http://127\.0\.0\.1:\K[0-9]+' /etc/nginx/sites-available/nova-api)

if [ "$current_port" == "3101" ]; then
  new_port="3100"
else
  new_port="3101"
fi

colored_echo "$blue" "CURRENT PORT: $current_port"
colored_echo "$blue" "NEW PORT: $new_port"

colored_echo "$yellow" "Compiling TypeScript..."
if ! npm run build; then
  colored_echo "$red" "Compilation failed. Aborting deployment."
  exit 1
fi

colored_echo "$yellow" "Building Docker image..."
docker build --no-cache -t ff-internal-new .
if [ $? -ne 0 ]; then
    colored_echo "$red" "Docker build failed. Aborting deployment."
    exit 1
fi

run docker stop FFInternalNew
run docker rm FFInternalNew

run docker run --name FFInternalNew --net APIs --net monitoring -p ${new_port}:3000 -d ff-internal-new

colored_echo "$yellow" "Waiting for the container to be ready..."

max_attempts=300
attempt=1
while [ $attempt -le $max_attempts ]; do
    if curl -s "http://localhost:${new_port}/health" >/dev/null; then
        echo -en "\r${green}Container is ready!                                                ${nc}"
        break
    fi
    echo -en "\r${cyan}Attempt $attempt/$max_attempts: Container not ready yet, waiting...                ${nc}"
    sleep 0.5
    ((attempt++))
done
echo

if [ $attempt -gt $max_attempts ]; then
    colored_echo "$red" "Container failed to start properly after $((max_attempts * 0.5)) seconds"
    exit 1
fi

run sudo sed -i "s/127\.0\.0\.1:$current_port/127.0\.0\.1:${new_port}/g" /etc/nginx/sites-available/nova-api
run sudo systemctl reload nginx

if docker ps -a --format '{{.Names}}' | grep -q '^FFInternal$'; then
  colored_echo "$red" "Removing old container..."
  run docker stop FFInternal
  run docker rm FFInternal
fi

if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^ff-internal:latest$'; then
  colored_echo "$red" "Cleaning up images..."
  run docker rmi ff-internal:latest
fi

run docker rename FFInternalNew FFInternal

colored_echo "$green" "Deployment Complete!"

if [ "$no_logs" = false ]; then
  colored_echo "$cyan" "Following container logs in real-time (Press Ctrl+C to exit)..."
  docker logs -f FFInternal
fi