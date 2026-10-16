#!/usr/bin/env bash
# Run Maestro flows against the build already installed on the simulator/emulator.
# Usage: scripts/e2e.sh <ios|android> [development|preview|production] [flow.yaml ...]
# With no flows, runs every top-level flow in .maestro/.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
unset SDKROOT # only prebuild/pod install need it (env.sh); keep it away from simctl/Maestro

platform=${1:?Usage: e2e.sh <ios|android> [variant] [flows...]}
variant=${2:-development}
shift $(($# >= 2 ? 2 : 1))
flows=("$@")
[[ ${#flows[@]} -gt 0 ]] || flows=(.maestro)

app_id=$(APP_VARIANT=$variant npx expo config --json --type public | node -e \
  'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)')
# URL scheme of the variant (eyeapp-dev, eyeapp-preview, eyeapp): flows open `${SCHEME}://break?...`.
scheme=$(APP_VARIANT=$variant npx expo config --json --type public | node -e \
  'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)')

if [[ $variant == development ]] && ! curl -fs "http://localhost:$METRO_PORT/status" | grep -q running; then
  echo "Metro is not running. Start it with: npm run dev" >&2
  exit 1
fi

device=$(scripts/boot.sh "$platform")
out="artifacts/maestro/$platform-$variant-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
echo "Maestro: $app_id on $platform ($device) -> $out"
# Flows tagged for the other platform only (e.g. the Android notification shade) are skipped.
other=$([[ $platform == ios ]] && echo android || echo ios)
# Flows for the Screen Time smart mode run only against a SCREENTIME=1 build (G13, D68).
exclude="$other-only"
[[ ${SCREENTIME:-0} == 1 ]] || exclude+=",screen-time-only"
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" --exclude-tags "$exclude" --test-output-dir "$out" "${flows[@]}"
