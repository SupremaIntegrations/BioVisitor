#!/bin/bash
mkdir -p /home/runner/workspace/.redis-data
redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --protected-mode no \
  --dir /home/runner/workspace/.redis-data --dbfilename dump.rdb \
  --save 30 1 --save 300 10 2>/dev/null
sleep 1

cd /home/runner/workspace/biovisitor-backend && npm run start:dev &
BACKEND_PID=$!

sleep 15

cd /home/runner/workspace/biovisitor-frontend && npm run dev &
FRONTEND_PID=$!

wait $BACKEND_PID $FRONTEND_PID
