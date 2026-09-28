#!/usr/bin/env bash
# Scénario de bout en bout sur l'émulateur : association, lancement d'un mode, PC éteint, allumage, mode lancé au réveil.
set -u
PKG=fr.rituelspc.app
mkdir -p shots
export E2E_DATA="$(mktemp -d)" E2E_CODE=/tmp/code.txt
FAIL=0

shot() { adb exec-out screencap -p > "shots/$1.png"; }
fail() { echo "ÉCHEC : $1"; FAIL=1; }

tap_text() { # appuie sur le premier élément dont le texte contient $1
  for _ in $(seq 1 25); do
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
    adb pull /sdcard/ui.xml /tmp/ui.xml > /dev/null 2>&1
    coords=$(python3 - "$1" <<'PY'
import re, sys
import xml.etree.ElementTree as ET
needle = sys.argv[1].lower()
for node in ET.parse('/tmp/ui.xml').iter('node'):
    label = ((node.get('text') or '') + ' ' + (node.get('content-desc') or '')).lower()
    if needle in label:
        x1, y1, x2, y2 = map(int, re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds')).groups())
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
)
    if [ -n "$coords" ]; then adb shell input tap $coords; return 0; fi
    sleep 1
  done
  fail "élément introuvable : $1"; adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; adb pull /sdcard/ui.xml "shots/ui-$(date +%s).xml" > /dev/null 2>&1
  return 1
}

start_server() { # $1 = fichier des actions, $2 = 1 pour créer un code d'association
  local log="/tmp/server-$(basename "$1").log"
  E2E_OPS="$1" E2E_MAKE_CODE="$2" node .github/scripts/android-e2e-server.js > "$log" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 30); do grep -q ready "$log" 2>/dev/null && return 0; sleep 1; done
  fail "serveur non démarré"; cat "$log"
}

rm -f /tmp/ops1.json /tmp/ops2.json
start_server /tmp/ops1.json 1
CODE=$(cat /tmp/code.txt)

adb install -r android/app/build/outputs/apk/debug/app-debug.apk > /dev/null
adb logcat -c
adb shell am start -n $PKG/.MainActivity > /dev/null
sleep 4; shot 1-non-associe

# 1) Association manuelle
tap_text "Saisir le code"; sleep 1
tap_text "Adresse du PC"; adb shell input text "10.0.2.2"
tap_text "Code d"; adb shell input text "$CODE"
sleep 1; shot 2-formulaire
tap_text "Associer"
sleep 8; shot 3-interface-du-pc

# 2) Lancer un mode depuis l'interface web
tap_text "Détente"
sleep 6; shot 4-mode-lance
grep -q '"op":"volume"' /tmp/ops1.json 2>/dev/null && echo "OK : le mode a été exécuté par le PC" || fail "le mode n'a pas été exécuté"

# 3) PC éteint : écran d'allumage
kill $SERVER; sleep 2
adb shell am force-stop $PKG
adb shell am start -n $PKG/.MainActivity > /dev/null
sleep 8; shot 5-pc-eteint
tap_text "Aucun (juste"; sleep 1; shot 6-liste-des-modes
tap_text "Détente"; sleep 1

# 4) Allumer : signal envoyé, puis le PC « démarre » (le serveur revient)
tap_text "Bouton allumer"; sleep 6; shot 7-allumage-en-cours
start_server /tmp/ops2.json 0
sleep 12; shot 8-pc-allume
grep -q '"op":"volume"' /tmp/ops2.json 2>/dev/null && echo "OK : le mode choisi a été lancé au réveil" || fail "le mode n'a pas été lancé après l'allumage"

adb logcat -d > shots/logcat.txt
if grep -E "FATAL EXCEPTION" shots/logcat.txt; then fail "l'application a planté"; fi
exit $FAIL
