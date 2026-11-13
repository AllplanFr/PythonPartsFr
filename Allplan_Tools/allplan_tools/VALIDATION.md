# Synthèse des validations du lot démarrage automatique

Validations effectuées le 2026-11-03 sur une source Git temporaire
(socle AIM + règles de fins de ligne + lot démarrage automatique), hors
dépôt de travail et sans modification de l'installation Allplan.

## Résultats

| Vérification | Résultat |
|---|---|
| Suite du lot AIM | 749 tests OK, 4 ignorés |
| Suite du lot démarrage automatique (package assemblé) | 35 tests OK |
| 11 empreintes de `WORKING_PYTHON_FILES` | conformes avec `core.autocrlf=true` et `false` |
| `verify_python(WORKING_REVISION)` | réussi dans les deux configurations |
| Preflight réel (`runtime/preflight.py`, une exécution) | `status: verified`, code de sortie 0, stderr vide |
| Écarts avant/après du package et du profil isolé | aucun (ajouts, suppressions, taille, SHA-256, date, y compris fichiers vides) |

Le preflight a utilisé le package assemblé avec `autocrlf=false` et le
profil isolé `localdata-0b05206`, avec `LOCALAPPDATA` et
`PYTHONDONTWRITEBYTECODE` limités au processus. Aucune application n'a été
ouverte ni arrêtée.

## Limites

- La livraison externe est issue d'une reconstruction locale
  (`resource_provenance: local reconstruction; pinned hashes verified`) ;
  l'archive et le descripteur ne sont pas reconstructibles depuis Git.
- `lovable_archive_obtained=false`.
- La correspondance avec le frontend `b00bb3b` n'a pas été contrôlée.
- Aucune recette native n'a été faite avec le package reconstruit.
- Les empreintes attendues n'ont pas été recalculées et aucun contrôle n'a
  été contourné.
