# Security policy

## Supported versions

Renaissance is pre-alpha. Only the `main` branch and the latest tagged release receive fixes.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository ("Security" tab, "Report a vulnerability").
Do not open a public issue for a security problem. You will get an acknowledgement within 7 days and a fix
or a plan within 30.

## What counts

- Token or password exposure (tokens belong in the platform keychain, never in files or logs)
- The hub acting outside its fixed tool set, or acting on data a tool did not return
- Secrets reaching the apps, the repo or the logs (the hub reads keys from its environment only)
- Any way for one household user to read another's history or rules
- Dependency vulnerabilities that are reachable in the apps or the hub

## Design rules that keep this small

- Keys exist on the hub only; the apps hold the hub address and a sign-in.
- The hub never logs request bodies or headers.
- Nothing leaves the house except the words typed and the metadata needed for a model call; no audio.
