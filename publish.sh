#!/bin/sh
# Publish the web part of the app: the tablet picks it up at its next start, no new APK needed.
#   ./publish.sh            copy the robot pages from arachne-18, write www/manifest.json, commit + push
#   ./publish.sh --apk      also build a new APK (only needed after changes in android/ = native code)
# What goes live this way: everything in www/ (pages, usb.js, usb_plan.json, hologram). Native plugins need --apk.
set -e
cd "$(dirname "$0")"
SRC=~/Documents/GitHub/arachne-18/tools/web
cp "$SRC/usb.html" www/
mkdir -p www/web/vendor/controls
for f in usb.js holo_fk.js update.js usb_plan.json holo.json holo.bin; do cp "$SRC/$f" www/web/; done
cp "$SRC/vendor/three.module.js" www/web/vendor/; cp "$SRC/vendor/controls/OrbitControls.js" www/web/vendor/controls/
python3 - <<'PY'
import hashlib, json, os, time
files = {}
for root, _, names in os.walk('www'):
    for n in names:
        p = os.path.join(root, n); rel = os.path.relpath(p, 'www')
        if rel == 'manifest.json' or n.startswith('.'): continue
        files[rel] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
old = json.load(open('www/manifest.json')) if os.path.exists('www/manifest.json') else {}
if old.get('files') == files: print('niets veranderd'); raise SystemExit
json.dump({'version': int(time.time()), 'files': files}, open('www/manifest.json', 'w'), indent=0, sort_keys=True)
print(f'manifest: {len(files)} bestanden, versie {time.strftime("%d/%m %H:%M")}')
PY
if [ "$1" = "--apk" ]; then
  npx cap sync android
  (cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug -q)
  cp android/app/build/outputs/apk/debug/app-debug.apk ~/Claude/ARACHNE.apk && echo "APK: ~/Claude/ARACHNE.apk"
fi
git add -A www publish.sh
git diff --cached --quiet || { git commit -qm "app: update $(date '+%Y-%m-%d %H:%M')"; git push -q && echo "online: de tablet haalt het op bij de volgende start"; }
