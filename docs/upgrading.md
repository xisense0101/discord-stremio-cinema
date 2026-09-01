# Upgrading Policy

1. Do NOT upgrade npm packages blindly.
2. Review `VERSIONS.md` for pinned releases.
3. Test changes with `./scripts/smoke-test.sh` and `pnpm test`.
4. Verify all 10 benchmarks pass before deploying.
