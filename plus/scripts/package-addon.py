# Packages the built addon (plus/addon/dist) into an installable ZIP: manifest.json, README.md,
# dist/ and assets/ without source maps. A cross-platform replacement for `pnpm package`, which
# needs zip and find. Run `pnpm build` in plus/addon first.
# Usage: python plus/scripts/package-addon.py
import json
import os
import zipfile

addon = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'addon')
os.chdir(addon)
manifest = json.load(open('manifest.json', encoding='utf-8'))
if not os.path.isfile(manifest['main']):
    raise SystemExit(f"{manifest['main']} is missing: run `pnpm build` in plus/addon first")

out = f"dist/{manifest['id']}-{manifest['version']}.zip"
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ('manifest.json', 'README.md'):
        z.write(name)
    for top in ('dist', 'assets'):
        for root, _, files in os.walk(top):
            for name in files:
                if name.endswith(('.map', '.zip')):
                    continue
                path = os.path.join(root, name)
                z.write(path, path.replace(os.sep, '/'))
print(os.path.abspath(out))
