# AI Coding Guide

- **Project role**: Node.js server bridges a Snapmaker/Klipper Moonraker instance to a browser UI. Status and camera updates flow Moonraker -> server -> browser.
- **Entry points**: Server in [server.js](../server.js), client UI in [public/app.js](../public/app.js), Moonraker JSON-RPC client in [utils/moonraker-client.js](../utils/moonraker-client.js), and status normalization in [utils/moonraker-status.js](../utils/moonraker-status.js).
- **Run/test**: Set `MOONRAKER_URL`, run `npm install`, then `npm start`. Tests use `npm test`.
- **Connection**: Moonraker's primary WebSocket is `/websocket`, normally on port 7125. `MOONRAKER_API_KEY` is supplied through `server.connection.identify`. The client reconnects every five seconds after loss.
- **Subscriptions**: `printer.objects.subscribe` provides initial object state and `notify_status_update` provides partial updates. Always merge notifications into cached state before mapping them.
- **Status model**: Browser payloads use `printer.klipper`, `printer.print`, `printer.temperatures`, `printer.camera`, and `printer.updatedAt`. Keep raw Moonraker state strings rather than introducing numeric protocol codes.
- **Print metadata**: `server.files.metadata` supplies estimated duration and fallback layer count. `estimatedRemainingSeconds` is an estimate and may be `null`.
- **State broadcast**: `broadcastToClients` throttles status events according to `WS_UPDATE_INTERVAL`. `buildStatusPayload` bundles printer state and user statistics.
- **Camera pipeline**: `server.webcams.list` selects the first enabled stream unless `CAMERA_STREAM_URL` overrides it. The server parses MJPEG boundaries, stores the latest frame, and relays frames through `/api/camera`.
- **User/IP tracking**: [utils/ip-utils.js](../utils/ip-utils.js) resolves client IPs. [utils/user-stats.js](../utils/user-stats.js) tracks browser and camera clients. Admin-only features must retain the local-IP policy.
- **API surface**: `GET /api/status`, `GET /api/camera`, `GET /api/admin`, and the browser WebSocket root. Printer selection is configuration-driven; there is no LAN discovery endpoint.