# demo-video

A [Remotion](https://www.remotion.dev) project that renders the example
"verification recording" shown in the landing page demo. The video is a
synthetic mock (an invented app called "acme web-app"), not a real recording.

This folder is **not** part of the pnpm workspace, so CI and `pnpm install` at
the repo root never touch it.

```bash
cd tools/demo-video
pnpm install
pnpm studio    # preview and scrub in the browser
pnpm render    # writes out/verification.mp4
```

After rendering, optimize it and copy it into the web app:

```bash
ffmpeg -i out/verification.mp4 -an -c:v libx264 -crf 30 -preset slow \
  -pix_fmt yuv420p -movflags +faststart out/verification-web.mp4
ffmpeg -ss 1 -i out/verification-web.mp4 -frames:v 1 -q:v 4 out/poster.jpg
cp out/verification-web.mp4 ../../apps/web/public/demo/verification.mp4
cp out/poster.jpg ../../apps/web/public/demo/poster.jpg
```

Check [Remotion's license](https://www.remotion.dev/license) before using it in a
company with more than a few people.
