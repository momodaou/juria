#!/usr/bin/env bash
# JURIA — déploiement en une seule commande (13/09/2026, pour éviter de
# coller plusieurs blocs de commandes gcloud à chaque changement — voir
# CLAUDE.md/HISTORY.md). S'appuie sur scripts/gcloud-docker.sh (aucun outil
# GCP installé sur l'hôte).
#
# Usage :
#   ./scripts/deploy.sh                 -> API + frontend
#   ./scripts/deploy.sh api             -> API seule
#   ./scripts/deploy.sh web             -> frontend seul
#   ./scripts/deploy.sh migration fichier.sql [utilisateur]
#                                        -> migration Cloud SQL (utilisateur
#                                           par défaut : postgres — voir le
#                                           piège "must be owner of table"
#                                           déjà documenté dans CLAUDE.md)
#
# S'arrête au premier échec (set -e) plutôt que d'enchaîner sur une base
# à moitié à jour.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REGION="europe-west1"
API_IMAGE="europe-west1-docker.pkg.dev/jfc-juria/juria/app:latest"
WEB_IMAGE="europe-west1-docker.pkg.dev/jfc-juria/juria/web:latest"
BUCKET_MIGRATIONS="gs://jfc-juria_cloudbuild/tmp-migrations"

deployer_api() {
  echo "==> [1/2] Construction de l'image API…"
  ./scripts/gcloud-docker.sh builds submit --tag "$API_IMAGE" APP
  echo "==> [2/2] Déploiement de l'API sur Cloud Run…"
  ./scripts/gcloud-docker.sh run deploy juria --image="$API_IMAGE" --region="$REGION"
}

deployer_web() {
  echo "==> [1/2] Construction de l'image frontend…"
  ./scripts/gcloud-docker.sh builds submit --tag "$WEB_IMAGE" APP/frontend
  echo "==> [2/2] Déploiement du frontend sur Cloud Run…"
  ./scripts/gcloud-docker.sh run deploy juria-web --image="$WEB_IMAGE" --region="$REGION"
}

migrer() {
  local fichier="$1"
  local utilisateur="${2:-postgres}"
  local nom_gcs="$BUCKET_MIGRATIONS/$(basename "$fichier")"
  echo "==> [1/3] Envoi de la migration vers Cloud Storage…"
  ./scripts/gcloud-docker.sh storage cp "$fichier" "$nom_gcs"
  echo "==> [2/3] Import dans Cloud SQL (utilisateur : $utilisateur)…"
  ./scripts/gcloud-docker.sh sql import sql juria-pg "$nom_gcs" --database=juria --user="$utilisateur" --quiet
  echo "==> [3/3] Nettoyage du fichier temporaire…"
  ./scripts/gcloud-docker.sh storage rm "$nom_gcs"
}

case "${1:-both}" in
  api) deployer_api ;;
  web) deployer_web ;;
  both) deployer_api; deployer_web ;;
  migration)
    if [ -z "${2:-}" ]; then echo "Usage : $0 migration <fichier.sql> [utilisateur]"; exit 1; fi
    migrer "$2" "${3:-}"
    ;;
  *) echo "Usage : $0 [api|web|both|migration <fichier.sql> [utilisateur]]"; exit 1 ;;
esac

echo "✅ Terminé."
