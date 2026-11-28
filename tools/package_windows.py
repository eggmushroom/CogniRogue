"""Build a self-contained Windows x64 ZIP from prebuilt game/worker assets."""

import os
import platform
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
PYTHON_VERSION = "3.12.13"
PRODUCT = "CogniRogue"


def command(*args: str, output: bool = False, **env: str) -> str:
    result = subprocess.run(args, cwd=ROOT, check=True, text=True, encoding="utf-8", capture_output=output,
                            env={**os.environ, "UV_CACHE_DIR": str(ROOT / ".cache" / "uv"), **env})
    return result.stdout.strip() if output else ""


def find_python() -> Path:
    find = ("uv", "python", "find", "--managed-python", "--no-python-downloads", PYTHON_VERSION)
    try:
        return Path(command(*find, output=True))
    except subprocess.CalledProcessError:
        env = {"UV_PYTHON_INSTALL_DIR": str(ROOT / ".cache" / "windows-package" / "python")}
        command("uv", "python", "install", PYTHON_VERSION, **env)
        return Path(command(*find, output=True, **env))


def stage_runtime(bundle: Path, scratch: Path) -> None:
    runtime = bundle / "runtime"
    python = runtime / "python"
    node = runtime / "node"
    python.mkdir(parents=True)
    node.mkdir()

    interpreter = find_python()
    for name in ("python.exe", "python3.dll", "python312.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt"):
        shutil.copy2(interpreter.parent / name, python / name)
    # Optional authorized app-local CRT from Visual Studio's x64 Redist directory.
    # Don't copy arbitrary system DLLs from the build machine.
    if redist := os.environ.get("COG_WINDOWS_REDIST_DIR"):
        for name in ("msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
            shutil.copy2(Path(redist) / name, python / name)
    shutil.copytree(interpreter.parent / "DLLs", python / "DLLs", ignore=shutil.ignore_patterns("_test*", "_tkinter*", "tcl*", "tk86*"))
    shutil.copytree(interpreter.parent / "Lib", python / "Lib", ignore=shutil.ignore_patterns(
        "__pycache__", "*.pyc", "site-packages", "test", "tests", "ensurepip", "idlelib", "tkinter",
    ))
    requirements = scratch / "requirements.txt"
    command("uv", "export", "--locked", "--no-dev", "--no-emit-project", "--format", "requirements-txt",
            "--output-file", str(requirements), "--quiet")
    wheelhouse = os.environ.get("COG_WINDOWS_WHEELHOUSE")
    index = ["--no-index", "--find-links", str(Path(wheelhouse).resolve())] if wheelhouse else []
    pip_tmp = scratch / "pip-temp"
    pip_tmp.mkdir()
    command(str(interpreter), "-I", "-m", "pip", "--isolated", "install", "--disable-pip-version-check",
            "--target", str(python / "Lib" / "site-packages"), "--only-binary", ":all:",
            "--require-hashes", "--no-deps", "--no-compile", "--no-cache-dir", *index, "-r", str(requirements),
            TEMP=str(pip_tmp), TMP=str(pip_tmp))

    node_exe, version, platform_name, arch = command(
        "node", "-p", "[process.execPath,process.version,process.platform,process.arch].join('\\n')", output=True
    ).splitlines()
    if (platform_name, arch) != ("win32", "x64") or int(version.split(".")[0][1:]) < 22:
        raise RuntimeError("Packaging needs Windows x64 Node.js 22 or newer.")
    shutil.copy2(node_exe, node / "node.exe")
    license_file = Path(node_exe).with_name("LICENSE")
    if license_file.is_file():
        shutil.copy2(license_file, node / "LICENSE")
    else:
        # Windows Node installed from the MSI may omit its adjacent license.
        with urlopen(f"https://raw.githubusercontent.com/nodejs/node/{version}/LICENSE", timeout=30) as response:
            (node / "LICENSE").write_bytes(response.read())


def stage_game(bundle: Path) -> None:
    files = {
        "LICENSE": "LICENSE",
        "data/sources/SOURCES.md": "SOURCES.md",
        "dist/index.html": "dist/index.html",
        "packs/words.md": "packs/words.md",
        "pyproject.toml": "pyproject.toml",
        "tools/pdf2md.py": "tools/pdf2md.py",
        **{f".cache/{name}.mjs": f"workers/{name}.mjs" for name in ("runpool", "gen", "plan")},
        **{f"packaging/windows/{name}": name for name in ("Start-CogniRogue.cmd", "launcher.py", "README.txt")},
        **{path.relative_to(ROOT).as_posix(): path.relative_to(ROOT).as_posix()
           for path in (ROOT / "server").glob("*.py") if not path.name.startswith("test_")},
    }
    for source, destination in files.items():
        target = bundle / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / source, target)


def main() -> None:
    if os.name != "nt" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise SystemExit("Build this package on a Windows x64 machine.")
    scratch_base = ROOT / ".cache" / "windows-package"
    scratch_base.mkdir(parents=True, exist_ok=True)
    release = ROOT / "release"
    release.mkdir(exist_ok=True)
    output = release / f"{PRODUCT}-Windows-x64.zip"
    with tempfile.TemporaryDirectory(dir=scratch_base) as directory:
        scratch = Path(directory)
        bundle = scratch / PRODUCT
        stage_game(bundle)
        stage_runtime(bundle, scratch)
        pending = scratch / output.name
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(bundle.rglob("*")):
                if path.is_file() and path.suffix != ".pyc":
                    archive.write(path, path.relative_to(scratch).as_posix())
        pending.replace(output)
    print(f"{output} ({output.stat().st_size / (1024 * 1024):.1f} MiB)")


if __name__ == "__main__":
    main()
