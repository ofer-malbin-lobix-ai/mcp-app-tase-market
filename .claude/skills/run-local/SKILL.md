---
name: run-local
description: Start the local TASE market dev server on port 3001 and ngrok tunnel at tase-market.ngrok.dev
disable-model-invocation: true
---

Ensure the local TASE market dev server and ngrok tunnel are up and running. Kill any existing processes first.

## Steps

### 1. Kill existing processes on port 3001

Kill any node server AND any ngrok process tunneling to port 3001:
```bash
lsof -ti :3001 | xargs kill 2>/dev/null || true
ps aux | grep 'ngrok.*tase-market' | grep -v grep | awk '{print $2}' | xargs kill 2>/dev/null || true
```
Wait 2 seconds for ports to free up.

### 2. Start the local server

Run in background:
```bash
npx tsx --env-file=.env.local main.ts
```
Wait 3 seconds, then verify the output confirms: `TASE End of Day MCP server listening on http://localhost:3001/mcp`

### 3. Start ngrok tunnel

Check if ngrok is already tunneling to tase-market.ngrok.dev by scanning inspect ports 4040-4045:
```bash
for port in 4040 4041 4042 4043 4044 4045; do
  curl -s http://localhost:$port/api/tunnels 2>/dev/null | grep -q tase-market.ngrok.dev && echo "FOUND on inspect port $port" && break
done
```

If ngrok is NOT running or not connected, start it in background:
```bash
ngrok http 3001 --url=tase-market.ngrok.dev
```
Note: ngrok runs in TUI mode with no stdout. It auto-picks an available inspect port (4041 if 4040 is taken by another ngrok instance).

### 4. Verify

Wait 5 seconds for ngrok to connect, then verify:
```bash
# Verify server is responding
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/mcp

# Verify tunnel via ngrok API (check ports 4040-4045)
for port in 4040 4041 4042 4043 4044 4045; do
  curl -s http://localhost:$port/api/tunnels 2>/dev/null | grep -q tase-market.ngrok.dev && echo "Tunnel verified on inspect port $port" && break
done
```
Server should return HTTP 200. Tunnel should be found on one of the inspect ports.

Note: The ngrok background task will report exit code 144 when stopped — this is expected and harmless (TUI mode signal).

Report statuses:
- Server: `http://localhost:3001/mcp`
- Tunnel: `https://tase-market.ngrok.dev/mcp`

## Note

After `npm run build`, the server restarts automatically via a PostToolUse hook (`.claude/hooks/restart-server-after-build.sh`). ngrok reconnects on its own. Use `/run-local` only for initial startup or if ngrok is down.
