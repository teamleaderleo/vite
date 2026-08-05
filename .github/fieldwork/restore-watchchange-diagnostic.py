from pathlib import Path

path = Path("packages/vite/src/node/server/pluginContainer.ts")
text = path.read_text(encoding="utf-8")
old = """              `Error in error handler:\\\n${err2.stack || err2.message}\\\n`,
"""
new = """              `Error in error handler:\\n${err2.stack || err2.message}\\n`,
"""
if text.count(old) != 1:
    raise SystemExit(f"expected one altered diagnostic, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
