"""Configure LAN access without distributing credentials or requiring local Docker."""
import argparse
import ipaddress
import json
import secrets
import socket
import subprocess
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ONLYOFFICE_URL = "http://10.174.202.82:9898"


def lan_address(document_server_url):
    url = urlparse(document_server_url)
    if url.scheme not in {"http", "https"} or not url.hostname:
        raise ValueError("ONLYOFFICE URL must be an HTTP(S) URL")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.connect((url.hostname, url.port or (443 if url.scheme == "https" else 80)))
        return connection.getsockname()[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--onlyoffice-url", default=DEFAULT_ONLYOFFICE_URL)
    parser.add_argument("--backend-host", help="LAN IPv4 address of THIS Python computer")
    parser.add_argument("--from-container", action="store_true", help="Owner-only: read local onlyoffice-prod settings")
    args = parser.parse_args()
    env = ROOT / "backend" / ".env"
    if env.exists():
        print("backend/.env already exists; configuration kept unchanged.")
        return
    backend_host = args.backend_host or lan_address(args.onlyoffice_url)
    address = ipaddress.ip_address(backend_host)
    if address.version != 4 or address.is_loopback or address.is_unspecified or address.is_link_local:
        raise ValueError("Use the LAN IPv4 address of THIS backend computer; pass --backend-host explicitly")
    values = {
        "ONLYOFFICE_URL": args.onlyoffice_url.rstrip("/"),
        "BACKEND_CONTAINER_URL": f"http://{backend_host}:8010",
        "ONLYOFFICE_JWT_ENABLED": "false", "ONLYOFFICE_JWT_SECRET": "",
        "ONLYOFFICE_COMMAND_JWT_ENABLED": "false", "ONLYOFFICE_COMMAND_SECRET": "",
        "ONLYOFFICE_OUTBOX_JWT_ENABLED": "false", "ONLYOFFICE_OUTBOX_SECRET": "",
        "ONLYOFFICE_JWT_HEADER": "Authorization", "APP_SIGNING_SECRET": secrets.token_urlsafe(48),
        "BID_AI_BASE_URL": "", "BID_AI_MODEL": "", "BID_AI_API_KEY": "",
    }
    if args.from_container:
        result = subprocess.run(["docker", "exec", "onlyoffice-prod", "cat", "/etc/onlyoffice/documentserver/local.json"],
                                capture_output=True, check=True, text=True, encoding="utf-8")
        co = json.loads(result.stdout)["services"]["CoAuthoring"]
        token, secret = co.get("token", {}), co.get("secret", {})
        enabled = token.get("enable", {})
        values.update({
            "ONLYOFFICE_JWT_ENABLED": str(enabled.get("browser", True)).lower(),
            "ONLYOFFICE_JWT_SECRET": secret.get("session", secret.get("inbox", {})).get("string", ""),
            "ONLYOFFICE_COMMAND_JWT_ENABLED": str(enabled.get("request", {}).get("inbox", True)).lower(),
            "ONLYOFFICE_COMMAND_SECRET": secret.get("inbox", {}).get("string", ""),
            "ONLYOFFICE_OUTBOX_JWT_ENABLED": str(enabled.get("request", {}).get("outbox", True)).lower(),
            "ONLYOFFICE_OUTBOX_SECRET": secret.get("outbox", {}).get("string", ""),
            "ONLYOFFICE_JWT_HEADER": token.get("outbox", {}).get("header", "Authorization"),
        })
    env.write_text("\n".join(f"{key}={json.dumps(str(value))}" for key, value in values.items()) + "\n", encoding="utf-8")
    print("Created backend/.env. AI settings are blank; no credentials printed.")
    print("Document server:", values["ONLYOFFICE_URL"])
    print("Callback address:", values["BACKEND_CONTAINER_URL"])
    print("Verify this address is reachable from the document-server computer/container.")


if __name__ == "__main__":
    main()
