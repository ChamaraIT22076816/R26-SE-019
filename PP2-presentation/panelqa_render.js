// Chromium print helper for build_panelqa.py.
//   node panelqa_render.js <html> <pdf> [--measure]
// --measure prints {sectionId: heightInCssPx} as JSON and skips the PDF.
const { chromium } = require("playwright");
const path = require("path");

const [htmlPath, pdfPath] = process.argv.slice(2);
const measure = process.argv.includes("--measure");

const FOOT = `
<div style="width:100%; font-family:Helvetica,Arial,sans-serif; font-size:7pt; color:#666;
            padding:0 18mm; display:flex; justify-content:space-between; align-items:center;">
  <span>Suvana · Panel Q&amp;A · R26-SE-019 · IT22552860</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
  await page.goto("file://" + path.resolve(htmlPath));
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(400);

  if (measure) {
    // A4 content width at 18mm side margins = 174mm
    await page.setViewportSize({ width: Math.round(174 * 3.7795), height: 1200 });
    await page.waitForTimeout(300);
    const out = await page.evaluate(() => {
      const r = {};
      document.querySelectorAll("section.q").forEach((s) => {
        r[s.id] = s.getBoundingClientRect().height;
      });
      return r;
    });
    process.stdout.write(JSON.stringify(out));
  } else {
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOT,
      margin: { top: "13mm", bottom: "15mm", left: "18mm", right: "18mm" },
    });
  }
  await browser.close();
})();
