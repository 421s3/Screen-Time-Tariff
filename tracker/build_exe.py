"""Build the Windows executables with PyInstaller (one file each).

    pip install -r requirements-build.txt
    python build_exe.py                                   # both exes, backend defaults to localhost
    python build_exe.py --api-url https://<name>.up.railway.app --dashboard-url https://<name>.vercel.app

Outputs, in dist/:
- ScreenTimeTariff.exe         the desktop app (window + tray). This is the one users download.
- ScreenTimeTariffTracker.exe  the command-line tracker (same options as tracker.py).

--api-url / --dashboard-url only bake in *default URLs* (public addresses, not secrets). Users can
still change them without rebuilding: Settings in the app, a .env next to the exe, or API_URL /
DASHBOARD_URL environment variables. Nothing secret is ever bundled: no .env, no token file, no
queue/, no keys. The build fails if a local .env or token's contents end up inside an exe.
"""

import argparse
import json
import sys
from pathlib import Path

import PyInstaller.__main__

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
SEP = ";" if sys.platform == "win32" else ":"
FORBIDDEN = (".env", ".tracker_token.json")
TARGETS = {
    "gui": ("tracker_gui.py", "ScreenTimeTariff", "--windowed"),
    "cli": ("tracker.py", "ScreenTimeTariffTracker", "--console"),
}


def build(script: str, name: str, mode: str, defaults: Path, out: Path) -> Path:
    PyInstaller.__main__.run([
        str(HERE / script),
        "--name", name,
        "--onefile",
        mode,
        "--clean",
        "--noconfirm",
        "--distpath", str(out),
        "--workpath", str(BUILD / name),
        "--specpath", str(BUILD),
        "--paths", str(HERE),
        "--add-data", f"{HERE / 'blocklist.json'}{SEP}.",
        "--add-data", f"{defaults}{SEP}.",
        "--hidden-import", "pystray._win32",  # pystray picks its backend at runtime
        # Test-only modules; keep them out of the shipped exe
        "--exclude-module", "mock_backend",
        "--exclude-module", "pytest",
    ])
    exe = out / f"{name}.exe"
    data = exe.read_bytes()
    leaked = [f for f in FORBIDDEN if (HERE / f).exists() and (HERE / f).read_bytes().strip()
              and (HERE / f).read_bytes() in data]
    if leaked:
        exe.unlink()
        sys.exit(f"refusing to ship {name}.exe: {leaked} content found inside it")
    print(f"\nBuilt {exe} ({len(data) / 1e6:.1f} MB)")
    return exe


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api-url", default="", help="default backend URL baked into the exes (e.g. the Railway URL)")
    p.add_argument("--dashboard-url", default="", help="default dashboard URL (e.g. the Vercel URL)")
    p.add_argument("--only", choices=sorted(TARGETS), help="build just one exe")
    p.add_argument("--out", default=str(HERE / "dist"),
                   help="output folder (use another one if the current exe is running and locked)")
    a = p.parse_args(argv)
    for url in (a.api_url, a.dashboard_url):
        if url and not url.startswith(("https://", "http://")):
            sys.exit(f"not a URL: {url}")
    BUILD.mkdir(exist_ok=True)
    defaults = BUILD / "build_defaults.json"
    defaults.write_text(json.dumps({"apiUrl": a.api_url.rstrip("/"), "dashboardUrl": a.dashboard_url.rstrip("/")}),
                        encoding="utf-8")
    for key, (script, name, mode) in TARGETS.items():
        if a.only in (None, key):
            build(script, name, mode, defaults, Path(a.out))


if __name__ == "__main__":
    main()
