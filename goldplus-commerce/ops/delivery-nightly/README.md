# Delivery nightly timer

One timer, three jobs, daily at 02:30 Kampala time, run inside the live api container so the code that runs is
exactly the code that is deployed:

| Order | Job | What it does | Writes |
|---|---|---|---|
| 1 | calibration | fits corridor/hour/detour/last-mile factors (incl. the per-area with-pin split) from recorded deliveries and PROPOSES them | `delivery_calibration_proposal` (pending, replaced wholesale), window percentiles, re-band flags |
| 2 | area points | ≥3 tight rider handovers or ≥5 tight confirmed customer pins become the area's point; never over a `manual` point; wide spreads listed | `delivery_corridor.centroid_*`, one `geo_data_source_run` row |
| 3 | purge | deletes delivery pins past `pin_retention_days`, handover points past the same age, expired pending locations | `delivery_order_pin`, `fulfilment_deliveries.handover_*`, `whatsapp_pending_location` |

Nothing here changes a fee: proposals wait for a person; area points only move distances the model reads when
`distance_source = measured`.

## Install (once, on the host)

    cd /opt/goldplus/app/goldplus-commerce
    sudo cp ops/delivery-nightly/goldplus-delivery-nightly.{service,timer} /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now goldplus-delivery-nightly.timer
    systemctl list-timers goldplus-delivery-nightly.timer      # NEXT shows the next 02:30 Kampala (23:30 UTC)

`goldplus-alert@.service` (ops/backup) must already be installed; it is, for the backup and Lighthouse timers.

## Run by hand

    sudo systemctl start goldplus-delivery-nightly.service     # through systemd: logged, alerts on failure
    tail -40 /var/log/goldplus/delivery-nightly.log

Expected lines: `CALIBRATION_OK observations=… proposals=…`, `AREA_POINTS_OK areas=… written=… wide=…`,
`PIN_PURGE_OK pins=… pending=… handover_points=…`, then `=== done failed=0`.

## Why the api container and not the migrator image

The runner image compiles `apps/api/src/scripts/*` into `apps/api/dist/scripts/*.js`, so `docker exec` on the
running container needs no extra image, no worktree and no data mount. The parish import (`geo:parish-centroids`)
stays a migrator-image job because it reads `data/geo`, which the runner image does not carry.
