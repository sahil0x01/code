# Agent37 sandboxes

Written from Agent37's documentation (read 2026-11-28). **Not yet tried against the real service.**

## Set up

1. Create an API key in Agent37 and add a little balance. A sandbox needs one day of running cost in it.
2. Build both images in your workspace, from the repository root:

```bash
AGENT37_API_KEY=sk_live_... pnpm --filter @nullfuse/sandbox agent37:templates
```

3. In the worker's environment set `SANDBOX_DRIVER=agent37` and `AGENT37_API_KEY`. Run the build again
   after editing a Dockerfile. A worker that cannot read the Dockerfiles needs `AGENT37_TEMPLATE` and
   `AGENT37_BROWSER_TEMPLATE`, set to the names the build printed.

## How it works

- Every sandbox is the smallest shape, 2 vCPU, 4 GB and 4 GB disk, on shared hardware.
- The network is restricted by default (see sandbox-network.md). Agent37 allows listed domains on HTTPS only.
- Commands and files go through the exec endpoint, which takes no working directory, variables or input of
  its own, so the driver writes them into the command. Project variables therefore travel in the request
  body. A command ends after at most 14 minutes.
- A sandbox is deleted when its run ends. It sleeps after 5 idle minutes, and the 10-minute cleanup task
  deletes any older than 45 minutes. Sandboxes you create yourself are left alone.

## Check on the first live run

1. Both images build, and commands run as the `node` user.
2. A run clones, installs, tests and pushes, with the network restricted.
3. A screen recording is made and uploaded.
4. Stop ends a long command, and the sandbox disappears from the Agent37 dashboard.
5. The speed of a real build compared with Docker, and the charge compared with the saved cost.
6. Whether the sandbox list is paginated: the cleanup reads only the first answer.
