# Filigrane

Open `index.html` directly in a modern desktop browser. No web server, upload, or network request is used at runtime; the required PDF, PDF-export, and QR-reading scripts are bundled in `vendor/`.

This is a local-only implementation inspired by [FiligraneFacile](https://filigrane.beta.gouv.fr/).

Choose one or more images/PDFs, enter the text, then select **Create flat PDF**. Every output page is a JPEG embedded in an A4 PDF, matching the flattening behaviour of `BOPdfDocumentTemplate`.

The original Java watermark deliberately randomizes opacity, line spacing, blur radius, and (when enabled) colour/distortion. This local page enables the Java colour feature: each of the ten lines independently selects one of the Java RGBA colours. Distortion remains disabled. It also uses Java-equivalent integer sizing and translates the Java Gaussian kernel radius to the browser blur standard deviation.

Browser canvas and Java AWT still use different font rasterizers, and the Java barcode reader detects more barcode formats (and multiple codes) than the bundled browser QR reader. Those are the remaining rendering differences; the watermark geometry and compositing path follow the Java default implementation.
