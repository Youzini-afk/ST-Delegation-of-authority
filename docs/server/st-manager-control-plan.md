# ST-Manager Control From Authority Plan

This document tracks the Authority-side half of the ST-Manager remote backup control work.

## Goal

Authority already exposes the resource bridge that ST-Manager uses to read and write SillyTavern resources. The next step is to let an administrator open Authority inside SillyTavern and remotely command ST-Manager to create backups, list backups, preview restore actions, and restore backups.

## Boundary

Authority does not become the backup store. ST-Manager remains the execution center and source of truth for backup snapshots.

Authority will:

- Store ST-Manager URL and ST-Manager Control Key.
- Hide saved key plaintext after save.
- Call ST-Manager remote backup APIs.
- Render a small control panel in the Security Center.
- Reuse the existing Authority Bridge Key and resource type settings when pairing with ST-Manager.

Authority will not:

- Store backup files.
- Schedule backups itself.
- Delete ST-Manager backups.
- Delete SillyTavern resources remotely.

## Required ST-Manager APIs

Authority expects ST-Manager to expose these endpoints:

- `GET /api/remote_backups/control`
- `POST /api/remote_backups/control`
- `POST /api/remote_backups/control-key/rotate`
- `POST /api/remote_backups/probe`
- `POST /api/remote_backups/start`
- `GET /api/remote_backups/list`
- `GET /api/remote_backups/detail?backup_id=<id>`
- `POST /api/remote_backups/restore-preview`
- `POST /api/remote_backups/restore`

Machine-to-machine calls include:

```http
X-ST-Manager-Control-Key: <control-key>
```

## Authority API Surface

Add routes under `/api/plugins/authority/st-manager/control/*`:

- `GET /config`
- `POST /config`
- `POST /probe`
- `POST /pair`
- `POST /backup/start`
- `GET /backups`
- `GET /backups/:backup_id`
- `POST /restore-preview`
- `POST /restore`

## Authority Service

Create `packages/server-plugin/src/services/st-manager-control-service.ts`.

Responsibilities:

- Resolve persisted config path from Authority data paths.
- Normalize URL by trimming trailing slash.
- Save `manager_url`, `control_key_hash` or encrypted/opaque plaintext storage as available, and masked/fingerprint metadata.
- Use the stored Control Key for outbound calls.
- Reject outbound requests when URL or key is missing.
- Timeout requests and return clear error messages.

Stored public config:

```json
{
  "enabled": true,
  "manager_url": "https://manager.example",
  "control_key_masked": "stmc...abcd",
  "control_key_fingerprint": "12hexchars",
  "last_probe_at": "2026-05-01T00:00:00.000Z"
}
```

## Authority UI

Add a Security Center card below the existing ST-Manager Bridge card.

Controls:

- ST-Manager URL input.
- ST-Manager Control Key input.
- Save control config.
- Test ST-Manager connection.
- Pair current Bridge config into ST-Manager.
- Start backup.
- Refresh backup list.
- Select backup.
- Restore preview.
- Restore with overwrite checkbox and confirmation.

Important states:

- If Bridge is disabled, pairing is disabled.
- If Authority no longer has Bridge Key plaintext, pairing prompts the admin to rotate the Bridge Key first.
- Restore requires preview first.
- Overwrite requires explicit checkbox and confirmation.

## Tests

Server plugin:

- Config save does not return plaintext Control Key.
- Missing URL/key rejects probe.
- Probe/start/list/detail/restore requests include `X-ST-Manager-Control-Key`.
- Pair sends `st_url`, `remote_connection_mode=authority_bridge`, `remote_bridge_key`, and resource types.

SDK extension:

- Render helper displays saved masked key.
- Payload builder keeps URL and Control Key fields separate.
- Backup button is disabled when config is incomplete.
- Restore overwrite renders an explicit warning.

## Build

After implementation:

```powershell
npx vitest run packages/server-plugin/src/services/st-manager-control-service.test.ts packages/sdk-extension/src/security-center/st-manager-control.test.ts
npm run typecheck
npx vitest run
npm run build --workspace @stdo/server-plugin
npm run build --workspace @stdo/sdk-extension
node ./scripts/installable.mjs sync
npm run check:installable
git diff --check
```
