# YCBA Colors

Build color palettes and gradients from paintings. Choose Prominent, Saturated, or Complimentary palettes; adjust the color count; and drag the white dots to sample colors from the original image.

## Run locally

From the project folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000. No dependencies or build step are required. Uploaded paintings are processed locally in the browser.

## Update the gallery

Add paintings to `images/`, then run:

```sh
node sync-images.mjs
```

Refresh the page. TIFF originals get browser-compatible JPEG previews in `images/.gallery/`; generating those previews uses macOS's `sips` utility. Commit the generated `gallery-images.mjs` and previews with the original paintings.

## Export gradients

Use the **Export** buttons below the palette:

- **PNG** downloads the current gradient at the painting's dimensions. **S** remains the PNG shortcut.
- **SVG** preserves the dimensions, editable linear gradient, stop colors, exact offsets, and top-to-bottom direction.
- **ASE** exports an Adobe Swatch Exchange 1.0 group of RGB process swatches, one per gradient stop in order. Repeated colors remain separate stops, and swatch names include their positions. ASE contains colors rather than a gradient.

All formats include manual dot edits and the current palette method's stop positions. Files use `Colortest_day-month_number` with the selected extension; numbering is shared across formats, stored in the browser, and resets daily.

## Tests

```sh
node --test app.test.mjs palette.test.mjs picker.test.mjs gradient-export.test.mjs
```
