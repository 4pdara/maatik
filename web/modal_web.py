"""The website (web/) on Modal, next to the engine.

Deployed by .github/workflows/deploy-web.yml. The Next.js app is built inside the
image (standalone output) and served by Node. It reads:
    MAATIK_API_TOKEN       from the Modal secret maatik-engine-api (written by the engine deploy)
    MAATIK_WEB_PASSWORD    from the Modal secret maatik-web (written from the GitHub secret)
MAATIK_REQUIRE_PASSWORD=1 makes the site refuse to run without a password.

Cost: the container stops after 5 idle minutes; while it runs it is half a core and
512 MiB, about 3 cents an hour at Modal's list prices (25.11.2026).
"""

import os
import subprocess
from pathlib import Path

import modal

WEB_DIR = Path(__file__).parent
ENGINE_URL = "https://pdara--maatik-engine-api.us-east.modal.run"
PORT = 3000

image = (
    modal.Image.from_registry("node:22.23.0-bookworm-slim", add_python="3.12")
    .add_local_dir(
        WEB_DIR, "/app", copy=True,
        ignore=["node_modules", ".next", ".env", ".env.local", "*.tsbuildinfo", "modal_web.py"],
    )
    .run_commands(
        "cd /app && npm ci --no-audit --no-fund",
        "cd /app && NEXT_TELEMETRY_DISABLED=1 npx next build",
        # The standalone server does not include the static files; copy them next to it.
        "cp -r /app/.next/static /app/.next/standalone/.next/static",
    )
)

app = modal.App("maatik-web", image=image)


@app.function(
    secrets=[
        modal.Secret.from_name("maatik-engine-api", required_keys=["MAATIK_API_TOKEN"]),
        modal.Secret.from_name("maatik-web", required_keys=["MAATIK_WEB_PASSWORD"]),
    ],
    cpu=0.5,
    memory=512,
    scaledown_window=300,
    timeout=3600,
)
@modal.concurrent(max_inputs=50)
@modal.web_server(PORT, startup_timeout=60, label="maatik-web")
def web():
    env = dict(os.environ, PORT=str(PORT), HOSTNAME="0.0.0.0", NODE_ENV="production",
               NEXT_TELEMETRY_DISABLED="1", MAATIK_ENGINE_URL=ENGINE_URL, MAATIK_REQUIRE_PASSWORD="1")
    subprocess.Popen(["node", "server.js"], cwd="/app/.next/standalone", env=env)
