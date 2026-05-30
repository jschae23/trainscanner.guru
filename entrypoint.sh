#!/bin/sh
set -e

mkdir -p /app/data
chown nextjs:nodejs /app/data

exec su-exec nextjs "$@"
