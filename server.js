import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const app = express();

app.use(express.json({
  limit: '10mb'
}));

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL?.replace(/^["']|["']$/g, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/^["']|["']$/g, '');
const supabase = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// API Key Protection
const apiKey = process.env.API_KEY?.replace(/^["']|["']$/g, '');

const authenticate = (req, res, next) => {
  if (!apiKey) {
    // If no API_KEY is set in environment, allow open access (development mode)
    return next();
  }

  const providedKey = req.headers['x-api-key'];
  let token = providedKey;

  // Support Bearer Token fallback
  if (!token && req.headers['authorization']?.startsWith('Bearer ')) {
    token = req.headers['authorization'].substring(7);
  }

  if (token !== apiKey) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing API Key'
    });
  }

  next();
};

const PORT =
  process.env.PORT || 3000;

let browser;

/**
 * Browser singleton
 */
async function getBrowser() {

  if (!browser) {

    browser =
      await chromium.launch({

        headless: true,

        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      });

    browser.on(
      'disconnected',
      () => {
        browser = null;
      }
    );
  }

  return browser;
}

/**
 * Load HTML template
 */
async function loadTemplate(name) {

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

  return Handlebars.compile(
    html
  );
}

/**
 * Health route
 */
app.get('/', (_, res) => {

  res.json({
    success: true,
    service: 'playwright-pdf-service'
  });
});

/**
 * Generate PDF
 */
app.post(
  '/generate-pdf',
  authenticate,
  async (req, res) => {

    let context;

    try {

      const {
        template,
        data,
        uploadToSupabase,
        bucketName,
        fileName,
        userUuid
      } = req.body;

      /**
       * Validation
       */
      if (!template) {

        return res
          .status(400)
          .json({
            error:
              'template is required'
          });
      }

      if (!data) {

        return res
          .status(400)
          .json({
            error:
              'data is required'
          });
      }

      /**
       * Load template
       */
      const compiledTemplate =
        await loadTemplate(
          template
        );

      /**
       * Render HTML
       */
      const finalHtml =
        compiledTemplate(data);

      /**
       * Browser
       */
      const browser =
        await getBrowser();

      /**
       * Create context
       */
      context =
        await browser.newContext();

      /**
       * Create page
       */
      const page =
        await context.newPage();

      /**
       * Set HTML
       */
      await page.setContent(
        finalHtml,
        {
          waitUntil:
            'networkidle',

          timeout: 30000
        }
      );

      /**
       * Generate PDF
       */
      const pdf =
        await page.pdf({

          format: 'A4',

          printBackground: true,

          preferCSSPageSize: true,

          margin: {
            top: '0',
            right: '0',
            bottom: '0',
            left: '0'
          }
        });

      /**
       * Send PDF or Upload to Supabase Storage
       */
      if (uploadToSupabase) {

        if (!supabase) {
          throw new Error(
            'Supabase client is not initialized. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
          );
        }

        const bucket =
          bucketName || 'statements';

        const path =
          fileName ||
          (userUuid
            ? `${userUuid}/${template}_${Date.now()}.pdf`
            : `${template}_${Date.now()}.pdf`);

        const {
          error: uploadError
        } = await supabase.storage
          .from(bucket)
          .upload(path, pdf, {
            contentType:
              'application/pdf',
            cacheControl: '3600',
            upsert: true
          });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: { publicUrl }
        } = supabase.storage
          .from(bucket)
          .getPublicUrl(path);

        res.json({
          success: true,
          message:
            'PDF generated and uploaded successfully',
          url: publicUrl,
          path: path,
          bucket: bucket
        });

      } else {

        res.setHeader(
          'Content-Type',
          'application/pdf'
        );

        res.send(pdf);
      }

    } catch (err) {

      console.error(err);

      res.status(500).json({

        error:
          err instanceof Error
            ? err.message
            : 'Unknown error'
      });

    } finally {

      /**
       * Cleanup
       */
      if (context) {
        await context.close();
      }
    }
  }
);

/**
 * Start server
 */
app.listen(PORT, () => {

  console.log(
    `PDF service running on port ${PORT}`
  );
});