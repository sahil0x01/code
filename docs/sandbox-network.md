# Sandbox network

A run's commands could send your project's variables anywhere. Restricting the network narrows where.

| Setting (worker) | Meaning |
|---|---|
| `SANDBOX_NETWORK=restricted` | Only code hosts, package registries, recording storage and your added domains. Default with Docker and Agent37 |
| `SANDBOX_NETWORK=open` | No limit from us. Default with Daytona |
| `SANDBOX_ALLOW_DOMAINS` | Extra domains, comma separated. `*.example.com` includes subdomains |

The default list is in `packages/sandbox/src/network.ts`. If tests need an outside API or database, add its
domain. Only web traffic (ports 80 and 443) passes with Docker, so a database on another port stays
unreachable there.

## Docker

The sandbox joins a Docker network with no route out. A small proxy on that network forwards to allowed
domains and refuses private addresses. One proxy container (`nf-egress-...`) is kept per set of rules;
remove old ones with `docker rm -f`, then `docker network rm`. Programs that ignore `HTTP_PROXY` cannot
connect at all, including the browser loading outside images or scripts during a recording.

## Daytona

The domains are passed as the sandbox's allow list. Daytona accepts this from tier 3; on tiers 1 and 2
its own limits apply and cannot be changed per sandbox, so leave the setting at `open` there. Not yet
tried against Daytona.

## What this does not stop

- An allowed host can still receive data: a tricked agent could push to someone else's GitHub repository
  or publish a package, using a token of theirs.
- Secrets can leave through the run's own output: the branch, pull request or reply. Known values are
  removed from saved text, but not an encoded copy.
- The proxy checks the requested name and does not read encrypted traffic.
- Restricted Docker sandboxes share one network, so they can reach each other. On Linux, check that
  services listening on the host are not reachable from it.
