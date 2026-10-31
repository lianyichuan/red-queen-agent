"""Compatibility entry point for the transparent Umbrella application icon."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("make-icon.py")), run_name="__main__")
