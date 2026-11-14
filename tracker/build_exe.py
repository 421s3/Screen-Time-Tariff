"""Build dist/ScreenTimeTariffTracker.exe (one file, console) with PyInstaller.

    pip install -r requirements-build.txt
    python build_exe.py

Bundles only code and blocklist.json. Never bundles .env, the token file or queue/:
those are read from / written next to the .exe at run time, so one build works for any
backend and contains no secrets.
"""

import sys
from pathlib import Path

import PyInstaller.__main__

HERE = Path(__file__).resolve().parent
NAME = "ScreenTimeTariffTracker"
FORBIDDEN = (".env", ".tracker_token.json")


def main():
    PyInstaller.__main__.run([
        str(HERE / "tracker.py"),
        "--name", NAME,
        "--onefile",
        "--console",  # the console is the tracker's UI; closing it saves pending usage
        "--clean",
        "--noconfirm",
        "--distpath", str(HERE / "dist"),
        "--workpath", str(HERE / "build"),
        "--specpath", str(HERE / "build"),
        "--paths", str(HERE),
        "--add-data", f"{HERE / 'blocklist.json'}{';' if sys.platform == 'win32' else ':'}.",
        # Test-only module; keep it out of the shipped exe
        "--exclude-module", "mock_backend",
        "--exclude-module", "pytest",
    ])
    exe = HERE / "dist" / f"{NAME}.exe"
    data = exe.read_bytes()
    # Belt and braces: fail the build if a local secret file somehow got bundled
    leaked = [name for name in FORBIDDEN if name.encode() in data and (HERE / name).exists()
              and (HERE / name).read_bytes().strip() and (HERE / name).read_bytes() in data]
    if leaked:
        exe.unlink()
        sys.exit(f"refusing to ship: {leaked} content found inside the exe")
    print(f"\nBuilt {exe} ({len(data) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
