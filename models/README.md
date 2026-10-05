# Hand models

`hand-left.glb` and `hand-right.glb` are the "generic-hand" assets from the WebXR Input Profiles project
(https://github.com/immersive-web/webxr-input-profiles, package `@webxr-input-profiles/assets` 1.0.20).
The repository's licence file states the W3C Software and Document License; the npm package lists no licence
of its own, so confirm the terms before shipping.

They are not loaded by default: opponents have cat paws, which `js/scene.js` builds in code with no model file.
Add `?hands=human` to the address to use these human hands instead; each opponent then gets both hands.

`js/vendor/GLTFLoader.js` is the last non-module build of the three.js loader (r147, MIT).
