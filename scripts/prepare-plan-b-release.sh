#!/bin/bash
# Local/free build environment only. No AWS API calls or image publication.
set -euo pipefail
umask 077
command -v docker >/dev/null
commit=$(git rev-parse HEAD)
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo 'Use a clean committed checkout for the reproducible release.' >&2; exit 1
fi
out="artifacts/plan-b-release-$commit"
[ ! -e "$out" ] || { echo 'Release destination already exists; preserve it.' >&2; exit 1; }
mkdir -p "$out"
docker build --pull -t cloud-coordination-hub:release .
# Inspect packaged maintenance entry points; building alone is not runtime proof.
docker run --rm --network none --read-only --entrypoint node cloud-coordination-hub:release -e "const fs=require('fs');for(const f of ['init-postgres','provision-postgres','create-user','migrate-database'])fs.accessSync('/app/dist/backend/scripts/'+f+'.js');fs.accessSync('/app/node_modules/pg/package.json')"
docker save cloud-coordination-hub:release -o "$out/cloud-hub-image.tar"
(cd "$out" && sha256sum cloud-hub-image.tar > cloud-hub-image.tar.sha256)
printf '{"commit":"%s","purpose":"Plan B PostgreSQL; software only","builtAt":"%s"}\n' "$commit" "$(date -u +%FT%TZ)" > "$out/release.json"
cp scripts/bootstrap-plan-b.sh "$out/bootstrap-plan-b.sh"
# Separate bootstrap object is downloaded/verified before runtime installation.
(cd "$out" && tar -czf plan-b-release.tgz cloud-hub-image.tar cloud-hub-image.tar.sha256 release.json && sha256sum plan-b-release.tgz bootstrap-plan-b.sh > upload-checksums.txt)
printf 'Prepared local release in %s. Nothing uploaded or deployed.\n' "$out"
