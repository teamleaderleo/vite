import subprocess

# Keep the preparation recipe pinned while correcting its fixture's lint error.
source = subprocess.check_output(
    ['git', 'show', '67f10edeeed04e601eb85983625644438972af2a:scripts/config-inline-final-check-20260904.py'],
    text=True,
)
assert source.count('    setup() {},') == 1
source = source.replace(
    '    setup() {},',
    '    setup(build: unknown) {\n      void build\n    },',
)
exec(compile(source, 'config-inline-final-check-20260904.py', 'exec'))
