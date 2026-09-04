import subprocess

source = subprocess.check_output(
    ['git', 'show', '67f10edeeed04e601eb85983625644438972af2a:scripts/config-inline-final-check-20260904.py'],
    text=True,
)
assert source.count('    setup() {},') == 1
source = source.replace(
    '    setup() {},',
    '    setup(build: unknown) {\n      void build\n    },',
)
# Existing environments with an existing build enter the build compatibility merge.
# With no existing build, mergeConfig retains the override without writing to it.
old = '{ environments: { client: {} } }'
assert source.count(old) == 1
source = source.replace(old, '{ environments: { client: { build: {} } } }')
exec(compile(source, 'config-inline-final-check-20260904.py', 'exec'))
