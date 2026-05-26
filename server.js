import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';
import { chromium } from 'playwright';

const app = express();

app.use(express.json({
  limit: '10mb'
}));

let browser;

async function getBrowser() {

  if (!browser) {
    browser = await chromium.launch({
      headless: true
    });
  }

  return browser;
}

const templates = {};

async function loadTemplate(name) {

  if (templates[name]) {
    return templates[name];
  }

  const templatePath = path.join(
    process.cwd(),
    'templates',
    `${name}.html`
  );

  const html =
    await fs.readFile(
      templatePath,
      'utf-8'
    );

  templates[name] =
    Handlebars.compile(html);

  return templates[name];
}

app.post('/generate-pdf', async (req, res) => {

  try {

    const {
      template,
      data
    } = req.body;

    const compiledTemplate =
      await loadTemplate(template);

    const finalHtml =
      compiledTemplate(data);

    const browser =
      await getBrowser();

    const context =
      await browser.newContext();

    try {
      const page =
        await context.newPage();

      await page.setContent(
        finalHtml,
        {
          waitUntil: 'networkidle'
        }
      );

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true
      });

      res.setHeader(
        'Content-Type',
        'application/pdf'
      );

      res.send(pdf);

    } finally {
      await context.close();
    }

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});
app.get('/', (req, res) => {
  res.send('Playwright PDF Service Running');
});
app.listen(3000, () => {
  console.log(
    'PDF service running'
  );
});