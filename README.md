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

Click **Save** or press **S** to download the current gradient as a PNG at the painting's dimensions. Files use `Colortest_day-month_number.png`; numbering is stored in the browser and resets daily.

## Tests

```sh
node --test app.test.mjs palette.test.mjs picker.test.mjs gradient-export.test.mjs
```
