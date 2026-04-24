#!/bin/bash
set -e

pnpm install --prefer-offline --reporter=silent
pnpm --filter @workspace/db run push-force
