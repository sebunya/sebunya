# Slice 10-D DEPLOY FINAL post-deploy verification

The attempted deployment failed API startup health and was rolled back. After rollback, storefront returned `200`, API live health `200`, Preference Centre `200`, and the established logged-out `/admin` boundary returned `303`.

The rolled-back pre-10-D runtime returns `404` for `/admin/consent-operations` and `/api/admin/consent/operations/summary`; therefore the Consent Operations Control Room is not claimed as deployed.

Caddy retained ID `6f6e517ee9d02fa4021925866f8925ac1fd4d6c200905469ddfa4a11bf11f2a2` and start time `2026-07-15T14:30:06.898875595Z`. PostgreSQL retained `ebb57744324c0dc49f138ca9396dd88152f63ffdb3765522abad0f365af91c9c` and `2026-07-12T20:33:46.62170169Z`. Redis retained `32c8a24753941f4ed417dd2491a1424af38e9677ac78321df56c59bbd9b8cf39` and `2026-07-13T03:34:44.34918138Z`. All retained zero restart counts.
