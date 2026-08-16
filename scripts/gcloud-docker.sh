#!/usr/bin/env bash
# Exécute gcloud via l'image Docker officielle (Node.js/gcloud non installés en local).
# Les identifiants sont persistés dans ~/.config/gcloud sur l'hôte.
# Usage : ./scripts/gcloud-docker.sh <commande gcloud...>
exec docker run --rm -i \
  -v "$HOME/.config/gcloud:/root/.config/gcloud" \
  -v "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd):/workspace" \
  -w /workspace \
  google/cloud-sdk:slim \
  gcloud "$@"
