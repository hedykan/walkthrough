# Walkthrough editor figure

An interactive isometric explanation of the code-walkthrough extension. It is intentionally one upright editor—not a desk, workstation, or framed diagram. The editor faces the reader, follows the pointer with a restrained 3D tilt, and lifts the relevant physical controls as the walkthrough advances. A synchronized explanation below the model tells the story of every phase.

## Rebuild

```bash
node docs/walkthrough-editor/build.mjs
node docs/walkthrough-editor/build.mjs --dark
```

Open `walkthrough-editor.html`, then use `←` / `→`, `Space`, `Enter`, `Home`, `End`, or the controls in the drawing. Motion stops while the page is off-screen and follows `prefers-reduced-motion`.

The renderer and verification helpers in `kit/` and `scripts/` come from [Anatomy](https://github.com/wheresryan22/anatomy) under the MIT License. See [ANATOMY_LICENSE](./ANATOMY_LICENSE).
