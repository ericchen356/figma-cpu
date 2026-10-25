# Deploying CPU NATHAN through the Figma MCP, in about 10 calls

`use_figma` takes at most 50,000 characters of code a call and its sandbox has no `fetch`, so the
204 chunks of `deploy/out` would be 204 calls. Instead the whole build (the runtime once, every
step's data) goes into the file as one image:

1. `NATHAN_AT="-48,150000" npm run -s nathan` writes `deploy/out` (the editor placed at that point).
2. `node deploy/png/make-png.mjs deploy/out build.png`: the build as a 2048-wide greyscale PNG
   (3.2 MB of JSON, one byte a pixel, ~180 KB of PNG).
3. The MCP's `upload_assets` (count 1, `currentPageId` the target page) gives an upload URL;
   `curl -F "file=@build.png;type=image/png" <url>` places it on the page and returns its node id.
4. `node deploy/png/calls.mjs <node id> calls/ CPU` writes the calls: each reads the image back
   (`figma.getImageByHash(...).getBytesAsync()`), decodes it (`decode.js`: inflate, PNG unfiltering,
   UTF-8, in ~3 KB), runs the runtime with `Function` and its slice of the steps. Run them in order
   with `use_figma`; the last one removes the image.

The decoder handles grey, grey+alpha, RGB and RGBA 8-bit PNGs and every filter type, in case Figma
re-encodes the upload.
