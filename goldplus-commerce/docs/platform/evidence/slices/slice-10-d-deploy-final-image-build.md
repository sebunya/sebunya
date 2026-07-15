# Slice 10-D DEPLOY FINAL image build

From exact production source `d8ad79ea9ce62e1a15dd689145c13a8fb1e073ab`, `docker compose --env-file .env.production -f docker-compose.production.yml build api web` completed successfully using the repaired immutable Node digest.

Built API image: `sha256:52604e24746855a1fbae7a582fa7200215dd7b8b74b0171cf19df5b9569a892a`. Built web image: `sha256:9b417d2ce52ba5d83accf1163fd4573c96632207843be793af7ce893087a2cac`. Build evidence path: `/opt/goldplus/backups/slice-10-d-deploy-final-built-images-20260715T155556Z`.

The image build itself passed; runtime startup exposed a separate API packaging defect not detected by compile/build proof.
