"""Start the packaged single-user application; this file runs with bundled Python."""

import argparse
import ctypes
import json
import logging
import msvcrt
import os
import socket
import sys
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 17777  # A stable browser origin keeps local game progress across launches.
URL = f"http://{HOST}:{PORT}"
LOG = logging.getLogger("cognirogue")


def open_game() -> None:
    try:
        os.startfile(URL + "/")
    except OSError:
        print(f"无法打开默认浏览器，请手动打开 {URL}/", flush=True)


def existing_ready() -> bool:
    client = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            with client.open(URL + "/api/health", timeout=0.5) as response:
                payload = json.load(response)
                return isinstance(payload, dict) and payload.get("desktop") is True and payload.get("ok") is True
        except (OSError, ValueError):
            time.sleep(0.2)
    return False


def run(data: Path, no_browser: bool) -> int:
    # The lock is released by Windows on exit, even after a forced close.
    with (data / "instance.lock").open("a+b") as guard:
        guard.seek(0)
        try:
            msvcrt.locking(guard.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            if not existing_ready():
                print("CogniRogue 已在启动或退出中。请稍后再打开。", file=sys.stderr)
                return 1
            print(f"CogniRogue 已在运行：{URL}/")
            if not no_browser:
                open_game()
            return 0

        log_file = data / "launcher.log"
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
            handlers=[RotatingFileHandler(log_file, maxBytes=512_000, backupCount=2, encoding="utf-8")],
        )
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                try:
                    listener.bind((HOST, PORT))
                except OSError:
                    LOG.exception("无法绑定本机端口 %s", PORT)
                    print(f"无法使用本机端口 {PORT}。请关闭占用它的程序，再重新启动。", file=sys.stderr)
                    return 1
                listener.set_inheritable(False)
                return serve(data, listener, no_browser)
        except Exception:
            LOG.exception("完整版启动失败")
            print(f"启动失败。日志：{log_file}", file=sys.stderr)
            return 1


def serve(data: Path, listener: socket.socket, no_browser: bool) -> int:
    os.environ["COG_DESKTOP"] = "1"
    os.environ["COG_DESKTOP_DATA"] = str(data)
    sys.path.insert(0, str(ROOT))  # -I keeps the host's site and PYTHONPATH out.

    try:
        ctypes.WinDLL("msvcp140.dll")  # PyMuPDF's Windows wheel needs the x64 C++ runtime.
    except OSError:
        LOG.exception("找不到 Microsoft Visual C++ x64 运行库")
        print("缺少 Microsoft Visual C++ v14 x64 运行库，请按 README.txt 的链接安装后再启动。", file=sys.stderr)
        return 1
    import pymupdf  # noqa: F401 — verify the bundled PDF engine before opening the game.
    import uvicorn
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from starlette.responses import PlainTextResponse
    from server.app import app

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[HOST])

    @app.middleware("http")
    async def same_origin(request, call_next):
        if request.url.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if (origin is not None and origin != URL) or request.headers.get("sec-fetch-site") == "cross-site":
                return PlainTextResponse("Only the local game may modify data.", status_code=403)
        return await call_next(request)

    class DesktopServer(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets)
            if self.started:
                print(f"CogniRogue：{URL}/\n数据目录：{data}\n按 Ctrl+C 退出。", flush=True)
                if not no_browser:
                    threading.Thread(target=open_game, daemon=True).start()

    config = uvicorn.Config(app, host=HOST, port=PORT, workers=1, log_config=None, access_log=False,
                            proxy_headers=False, lifespan="on", ws="none")
    server = DesktopServer(config)
    try:
        server.run(sockets=[listener])
    except KeyboardInterrupt:
        return 0
    if not server.started:
        print(f"启动失败。日志：{data / 'launcher.log'}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true", help="only start the local service")
    args = parser.parse_args()
    profile = os.environ.get("LOCALAPPDATA")
    if not profile:
        print("找不到 Windows 的 LOCALAPPDATA，无法保存游戏数据。", file=sys.stderr)
        return 1
    data = Path(profile).resolve() / "CogniRogue"
    try:
        data.mkdir(parents=True, exist_ok=True)
        return run(data, args.no_browser)
    except OSError as exc:
        print(f"无法访问 CogniRogue 数据目录 {data}：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
