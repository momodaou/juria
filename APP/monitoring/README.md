# JURIA — Supervision production (GCP Cloud Monitoring)

Mis en place le 17/08/2026 pour combler l'absence totale d'alerte en
production (une panne pouvait passer inaperçue plusieurs jours). Configuré
manuellement via `scripts/gcloud-docker.sh` (aucun outil GCP installé sur
l'hôte) — les fichiers ici sont la trace de ce qui a été créé, pas un
mécanisme d'application automatique (pas de Terraform/Deployment Manager
sur ce projet).

## En place

| Élément | Détail |
|---|---|
| Canal de notification | E-mail `mohameddaou22@gmail.com` (`notificationChannels/16089389092260988572`) |
| Vérification de disponibilité | `juria-api-health` — `GET https://juria-552099340909.europe-west1.run.app/health`, toutes les 5 min |
| Vérification de disponibilité | `juria-web-accueil` — `GET https://juria-web-552099340909.europe-west1.run.app/`, toutes les 5 min |
| Alerte | `policy-api-health.yaml` — déclenchée si `juria-api-health` échoue |
| Alerte | `policy-web-accueil.yaml` — déclenchée si `juria-web-accueil` échoue |
| Alerte | `policy-api-5xx.yaml` — déclenchée si l'API renvoie plus de 5 erreurs 5xx sur une fenêtre de 5 minutes (capture les pannes applicatives que `/health` ne verrait pas, `/health` ne touchant ni la base ni les autres routes) |

## Rejouer/adapter une politique d'alerte

```bash
./scripts/gcloud-docker.sh alpha monitoring policies create --policy-from-file=APP/monitoring/policy-api-5xx.yaml
```

Lister les politiques actives :
```bash
./scripts/gcloud-docker.sh alpha monitoring policies list --format="table(displayName,enabled,name)"
```

## Volontairement non fait

- Pas d'alerte sur la latence (p95/p99) — le trafic actuel (usage interne d'un petit cabinet) ne justifie pas ce niveau de finesse pour l'instant.
- Pas de dashboard Cloud Monitoring personnalisé — les graphes par défaut de Cloud Run (requêtes, latence, erreurs, CPU/mémoire) suffisent pour l'instant.
- Pas d'alerte sur Cloud SQL (CPU, connexions, espace disque) — à ajouter si l'usage grandit ; la base est petite et la charge actuelle faible.
- Pas de PagerDuty/Slack — l'e-mail suffit pour un opérateur unique. À revoir si l'équipe grandit.
