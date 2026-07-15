# Slice 9-ZH PRIME runner integrity preflight

Attempt 1 preflight result:

```text
authorization_module_instance_count = 1
canary_guard_instance_count = 1
diagnostic_transport_instance_count = 1
feature_gate_reader_instance_count = 1
repository_instance_count = 1
duplicate_module_detected = false
mixed_source_dist_import_detected = false
mixed_alias_relative_import_detected = false
safe_to_attempt = true
```

The result is boolean/count-only. No secrets, environment values, authorization headers, or private recipients were exposed.
