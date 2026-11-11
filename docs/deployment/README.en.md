# Deploy Excalink

[Project home](../../README.en.md) · [简体中文](README.md) · English

Each Excalink instance has one owner workspace. Run a single instance and give only one application process write access to its data directory.

## Docker Compose

You need Git, Docker, and Docker Compose v2. Compose builds the image from source.

```sh
git clone https://github.com/xiongwei-git/Excalink.git
cd Excalink
cp .env.example .env
chmod 600 .env
```

For a local trial, keep the defaults and open `http://127.0.0.1:4173`. For a server deployment, choose an authentication mode below and set the external origin and host port.

```dotenv
APP_ORIGIN=https://board.example.com
EXCALINK_PORT=14173
```

Set `APP_ORIGIN` to the origin users open in their browser, including the scheme, hostname, and any non-default port. Serve the app at `/` on a dedicated hostname. Compose maps the host loopback port to port `4173` in the container.

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 whiteboard
```

## Authentication

Choose one `AUTH_MODE` in `.env` and protect the credentials in that file.

| Mode | Owner access |
| --- | --- |
| `public` (default) | Anyone who can reach the service can edit the current board, access the archive, and perform administrative actions. |
| `password` | One local username and password. |
| `oidc` | One account authenticated by the identity provider with a matching `sub`. |

In password and OIDC modes, guests with a share link can edit the corresponding board. Existing links remain valid after a password or authentication mode change until the owner revokes them.

### Local password

Set `AUTH_MODE=password` and `AUTH_USERNAME=admin` in `.env`, using your preferred username. The command below requires Python 3. It prompts for a password and prints a `PASSWORD_HASH` line. Paste the entire line into `.env` in place of the existing empty entry. Repeat this step to reset the password.

```sh
docker compose build whiteboard
python3 - <<'PY'
import getpass
import subprocess

password = getpass.getpass("Password: ")
if not password or password != getpass.getpass("Repeat password: "):
    raise SystemExit("Empty or mismatched password")
code = """
const { randomBytes, scryptSync } = require('node:crypto');
const password = require('node:fs').readFileSync(0);
const salt = randomBytes(16);
console.log('PASSWORD_HASH=' + salt.toString('hex') + ':' +
  scryptSync(password, salt, 64).toString('hex'));
"""
subprocess.run(
    ["docker", "compose", "run", "--rm", "--no-deps", "-T",
     "--entrypoint", "node", "whiteboard", "-e", code],
    input=password.encode("utf-8"), check=True,
)
PY
```

For a direct Node.js deployment, skip the build command and replace the command list in `subprocess.run` with `["node", "-e", code]`.

### OpenID Connect

Create a dedicated confidential web client with your identity provider. Enable the authorization code flow, PKCE S256, and `client_secret_post`. Register the exact callback URL `https://board.example.com/auth/callback`.

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=excalink
OIDC_CLIENT_SECRET='replace-with-client-secret'
OIDC_SUBJECT=replace-with-user-sub
```

Use the provider's published issuer for `OIDC_ISSUER`, including its path if present. On startup, the app contacts the issuer from inside the container for discovery. The app verifies signed ID tokens. Set `OIDC_SUBJECT` to the intended user's ID token `sub` for this client.

**Tinyauth v5.2.0** has been verified in an isolated setup. Merge these settings into the Tinyauth service and keep its existing clients. Mount a dedicated random secret at the specified path, make it readable by the service user, and use the same secret as Excalink's `OIDC_CLIENT_SECRET`.

```yaml
environment:
  TINYAUTH_OIDC_CLIENTS_EXCALINK_CLIENTID: excalink
  TINYAUTH_OIDC_CLIENTS_EXCALINK_CLIENTSECRETFILE: /run/secrets/excalink-client-secret
  TINYAUTH_OIDC_CLIENTS_EXCALINK_TRUSTEDREDIRECTURIS: https://board.example.com/auth/callback
  TINYAUTH_OIDC_CLIENTS_EXCALINK_NAME: Excalink
volumes:
  - ./secrets/excalink-client-secret:/run/secrets/excalink-client-secret:ro
```

For a local username account in this Tinyauth version, calculate the `sub` in Python using `uuid.uuid5(uuid.NAMESPACE_URL, username + ":" + client_id)`. For other versions or login methods, use the `sub` issued by your provider.

## HTTPS and reverse proxy

This example assumes Nginx and Docker run on the same host. Point your DNS record at the server, configure the certificate in Nginx, and enable an HTTP-to-HTTPS redirect. In BaoTa, create a reverse proxy site with the same upstream and enable SSL and forced HTTPS. Merge the directives into the existing HTTPS `server` and `location /` blocks to avoid duplicate definitions.

```nginx
client_max_body_size 22m;
access_log off;
error_log /var/log/nginx/excalink.error.log crit;

location / {
    proxy_pass http://127.0.0.1:14173;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
```

Set the log path to a writable location for Nginx. Share URLs and OIDC callbacks contain sensitive parameters. Keep full request URLs out of proxy and upstream logs. Let Excalink handle app login, share links, and MCP authentication. Check that any additional proxy login rules allow those flows.

Check anonymous access through your configured hostname.

```sh
curl -fsS https://board.example.com/auth/session
curl -sS -o /dev/null -w '%{http_code}\n' https://board.example.com/api/current
```

Expect `owner: false` and HTTP `401` in `password` or `oidc` mode, or `owner: true` and HTTP `200` in `public` mode. In a browser, verify that you can sign in, draw, refresh, and save a board to the archive. In a second browser, check that a shared copy can be edited and becomes inaccessible after you revoke its link.

## Updates and backups

The `whiteboard` named volume stores canvases, archived boards, and images under `/data` in the container. Keep the Compose project name stable during updates. Stop the app and back up the entire volume. Record the current Git commit and keep a protected copy of `.env`.

```sh
docker compose stop whiteboard
docker compose run --rm --no-deps -T --entrypoint tar whiteboard \
  -C /data -czf - . > "excalink-data-$(date +%Y%m%d-%H%M%S).tar.gz"
```

Once the backup command succeeds and you have checked the archive with `tar -tzf`, update the checkout and rebuild.

```sh
git pull --ff-only && docker compose up -d --build
```

To restore, stop the app, extract the entire archive into an empty volume or data directory, and give the app user write access. After editing only `.env`, run `docker compose up -d --force-recreate`. A regular `docker compose down` preserves the volume. `docker compose down -v` deletes it.

## Run with Node.js

You need Node.js 22.12 or later and npm. Run these commands from the repository root.

```sh
npm ci
npm run build
cp .env.example .env
chmod 600 .env
node --env-file=.env src/server.js
```

Edit `.env` before starting the app if you need custom settings. The process binds to `127.0.0.1:4173` by default. For direct deployment, use `PORT` to change the port and `BIND_HOST` to change the bind address. Data defaults to `data/` in the working directory. Set `BOARD_DATA_DIR` to a fixed writable directory if needed. With the example `APP_ORIGIN`, open `http://127.0.0.1:4173`. Update it to match the external origin when changing ports or adding a proxy.

## Connect MCP

Set a dedicated random `MCP_TOKEN` of at least 32 characters in the server's `.env`, then recreate the container or restart the Node.js app. On the machine running the MCP client, check out the same source version and run `npm ci`. Configure the client to launch `node /absolute/path/to/Excalink/src/mcp.js` over stdio. Set `MCP_BOARD_ORIGIN` to the server's external origin and use the same `MCP_TOKEN` in the client environment.

For Mermaid conversion and PNG or SVG export, run `npx playwright install chromium` on the MCP client machine or set `MCP_CHROME_CHANNEL=chrome` to use an installed Chrome. See the [MCP compatibility reference](../MCP_COMPATIBILITY.md) for the tool list.
