"""Inject FIRMWARE_VERSION from firmware/VERSION.

There is ONE source of truth for the firmware version and it is the VERSION
file, because the previous arrangement -- a string literal in platformio.ini --
drifted the first time somebody forgot, and then stayed at 0.9.0 across every
change merged on 2026-09-19, several of which changed device behaviour.

That matters more than tidiness now: the OTA server compares the version a
device reports against the promoted one, so a stale literal means a device
either never updates or updates in a loop.

The same file is read by .github/workflows/firmware-release.yml, so the artifact
path, the manifest and the compiled-in string cannot disagree.
"""
import os

Import("env")  # noqa: F821 -- injected by PlatformIO

version_path = os.path.join(env["PROJECT_DIR"], "VERSION")  # noqa: F821
with open(version_path) as fh:
    version = fh.read().strip()

if not version:
    raise ValueError("firmware/VERSION is empty")

# StringifyMacro quotes it correctly for the compiler command line; doing that
# by hand with escaped quotes is what made the old platformio.ini line ugly
# enough that nobody wanted to touch it.
env.Append(CPPDEFINES=[("FIRMWARE_VERSION", env.StringifyMacro(version))])  # noqa: F821
print("firmware version: %s (from VERSION)" % version)
