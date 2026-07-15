# Schema & Migration Matrix

Generated @ 4b4016c. Migrations are additive; never rewrite applied migrations.
Production migration execution requires operator approval (BLOCKED_EXTERNAL here).

## Schema files (apps/api/src/infrastructure/db/schema)
```
activation-dry-run.ts
activation-live-canary.ts
activation-live-review.ts
activation.ts
addresses.ts
advertising.ts
commerce.ts
consent-foundation.ts
consent.ts
governance.ts
identity.ts
index.ts
measurement-advanced.ts
measurement.ts
measurement_control_tower.ts
phase11.ts
preferences.ts
product_finder.ts
products.ts
recommendations.ts
release_readiness.ts
system.ts
telemetry.ts
```

## Migrations (apps/api/src/infrastructure/db/migrations)
```
0000_fuzzy_switch.sql
0001_red_flatman.sql
0002_outstanding_the_order.sql
0003_ambiguous_makkari.sql
0004_glorious_lionheart.sql
0005_fast_proudstar.sql
0006_colossal_brood.sql
0007_safe_piledriver.sql
0008_slimy_killmonger.sql
0009_spooky_shockwave.sql
0010_living_clint_barton.sql
0011_light_shatterstar.sql
0012_harsh_maverick.sql
0013_outgoing_molecule_man.sql
0014_smooth_tana_nile.sql
0015_funny_vampiro.sql
0016_open_doctor_strange.sql
0017_lyrical_groot.sql
0018_real_prism.sql
0019_red_corsair.sql
0020_stiff_random.sql
0021_military_punisher.sql
0022_low_phil_sheldon.sql
```

Highest applied-in-production migration: unverifiable from this environment
(no ssh); treat production migration state as BLOCKED_EXTERNAL evidence item.
