const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { extractTextFromImage, extractTextFromScannedPDF } = require('../extractor/aiApiCall');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { PDFDocument } = require('pdf-lib');


const router = express.Router();
const upload = multer({ 
    dest: path.join(__dirname, '..', 'uploads'),
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === 'application/pdf' ||
            file.mimetype.startsWith('image/')
        ) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF and image files are allowed.'));
        }
    }
});

const dbPool = new Pool({
  connectionString: process.env.NEON_DB_URL || 'postgresql://neondb_owner:npg_PVs3ewizcxA5@ep-shiny-math-a8lmusqf-pooler.eastus2.azure.neon.tech/before_verify2',
  ssl: {
    require: true,
    rejectUnauthorized: false
  }
});

const afterVerifyPool = new Pool({
  connectionString: process.env.NEON_AFTER_DB_URL || 'postgresql://neondb_owner:npg_PVs3ewizcxA5@ep-shiny-math-a8lmusqf-pooler.eastus2.azure.neon.tech/after_verify2',
  ssl: {
    require: true,
    rejectUnauthorized: false
  }
});

async function insertToPostgres(data) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'insert_to_pg.py');
    const py = spawn(
      'C:/Users/R Santosh Kumaar/AppData/Local/Programs/Python/Python313/python.exe',
      [scriptPath]
    );
    let stderr = '';
    py.stdin.write(JSON.stringify(Array.isArray(data) ? data : [data]));
    py.stdin.end();
    py.stderr.on('data', (d) => { stderr += d.toString(); });
    py.on('close', (code) => {
      if (code === 0) resolve();
      else reject(stderr || 'Insert script failed');
    });
  });
}

function isFlatObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.values(obj).every(v => typeof v === 'string');
}

// Helper to convert image to PDF and return the PDF file path
async function imageToPdf(imagePath, mimetype) {
  const imageBytes = fs.readFileSync(imagePath);
  const pdfDoc = await PDFDocument.create();
  let image;
  if (mimetype === 'image/png') {
    image = await pdfDoc.embedPng(imageBytes);
  } else {
    image = await pdfDoc.embedJpg(imageBytes);
  }
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  const pdfBytes = await pdfDoc.save();
  const pdfPath = imagePath + '.pdf';
  fs.writeFileSync(pdfPath, pdfBytes);
  return pdfPath;
}

// Utility: Flatten any nested object/array by converting non-string values to JSON strings
function flattenForDb(obj) {
  const flat = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      flat[key] = value;
    } else {
      flat[key] = JSON.stringify(value);
    }
  }
  return flat;
}

// Single image route
router.post('/upload-image', upload.single('file'), async (req, res) => {
  console.log('--- [UPLOAD] /upload-image called ---');
  try {
    if (!req.file.mimetype.startsWith('image/')) {
      console.log('Rejected: Not an image file');
      return res.status(400).json({ error: 'Only image files are allowed for this endpoint.' });
    }
    console.log('File received:', req.file.path);
    const text = await extractTextFromImage(req.file.path);
    console.log('OCR+AI result:', text);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (text.error) {
      console.log('AI error:', text.error, text.structured_data || '');
      return res.status(500).json({ error: text.error, details: text.structured_data || '' });
    }
    if (!isFlatObject(text)) {
      console.log('AI did not return flat object:', text);
      return res.status(500).json({ error: 'AI did not return a flat JSON object', details: text });
    }
    console.log('Inserting to DB:', text);
    await insertToPostgres(flattenForDb(text));
    const result = await dbPool.query('SELECT * FROM documents;');
    console.log('DB query result:', result.rows);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Image Processing Error:', error.stack || error);
    res.status(500).json({ 
      error: 'Image processing failed', 
      details: error.message || 'Internal server error' 
    });
  }
});

// PDF route
router.post('/upload-scanned-pdf', upload.single('file'), async (req, res) => {
  console.log('--- [UPLOAD] /upload-scanned-pdf called ---');
  try {
    if (!req.file) {
      console.log('Rejected: No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (req.file.mimetype !== 'application/pdf') {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.log('Rejected: Not a PDF file');
      return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
    }
    console.log('File received:', req.file.path);
    const text = await extractTextFromScannedPDF(req.file.path);
    console.log('OCR+AI result:', text);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (text.error) {
      console.log('AI error:', text.error, text.structured_data || '');
      return res.status(500).json({ error: text.error, details: text.structured_data || '' });
    }
    if (!isFlatObject(text)) {
      console.log('AI did not return flat object:', text);
      return res.status(500).json({ error: 'AI did not return a flat JSON object', details: text });
    }
    console.log('Inserting to DB:', text);
    await insertToPostgres(flattenForDb(text));
    const result = await dbPool.query('SELECT * FROM documents;');
    console.log('DB query result:', result.rows);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('PDF Processing Error:', error.stack || error);
    res.status(500).json({ 
      error: 'PDF processing failed', 
      details: error.message || 'Internal server error' 
    });
  }
});

// Accept multiple files for images
router.post('/upload-images', upload.array('files'), async (req, res) => {
  console.log('--- [UPLOAD] /upload-images called ---');
  try {
    if (!req.files || req.files.length === 0) {
      console.log('Rejected: No files uploaded');
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const results = [];
    const toInsert = [];
    for (const file of req.files) {
      try {
        if (!file.mimetype.startsWith('image/')) {
          results.push({ filename: file.originalname, error: 'Only image files are allowed for this endpoint.' });
          console.log('Rejected file (not image):', file.originalname);
          continue;
        }
        console.log('File received:', file.path);
        const text = await extractTextFromImage(file.path);
        console.log('OCR+AI result:', text);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        if (text.error) {
          results.push({ filename: file.originalname, error: text.error });
          console.log('AI error:', text.error);
        } else {
          results.push({ filename: file.originalname, extractedText: text });
          toInsert.push(flattenForDb(text));
        }
      } catch (err) {
        results.push({ filename: file.originalname, error: err.message });
        console.log('Error processing file:', file.originalname, err.stack || err);
      }
    }
    if (toInsert.length > 0) {
      try {
        console.log('Inserting to DB:', toInsert);
        await insertToPostgres(toInsert);
      } catch (err) {
        console.error('DB Insert Error (batch image):', err.stack || err);
      }
    }
    const result = await dbPool.query('SELECT * FROM documents;');
    console.log('DB query result:', result.rows);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Batch image processing failed:', error.stack || error);
    res.status(500).json({ error: 'Batch image processing failed', details: error.message });
  }
});

// Accept multiple files for PDFs
router.post('/upload-scanned-pdfs', upload.array('files'), async (req, res) => {
  console.log('--- [UPLOAD] /upload-scanned-pdfs called ---');
  try {
    if (!req.files || req.files.length === 0) {
      console.log('Rejected: No files uploaded');
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const results = [];
    const toInsert = [];
    for (const file of req.files) {
      if (file.mimetype !== 'application/pdf') {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        results.push({ filename: file.originalname, error: 'Invalid file type. Only PDF files are allowed.' });
        console.log('Rejected file (not PDF):', file.originalname);
        continue;
      }
      try {
        console.log('File received:', file.path);
        const text = await extractTextFromScannedPDF(file.path);
        console.log('OCR+AI result:', text);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        if (text.error) {
          results.push({ filename: file.originalname, error: text.error });
          console.log('AI error:', text.error);
        } else {
          results.push({ filename: file.originalname, extractedText: text });
          toInsert.push(flattenForDb(text));
        }
      } catch (err) {
        results.push({ filename: file.originalname, error: err.message });
        console.log('Error processing file:', file.originalname, err.stack || err);
      }
    }
    if (toInsert.length > 0) {
      try {
        console.log('Inserting to DB:', toInsert);
        await insertToPostgres(toInsert);
      } catch (err) {
        console.error('DB Insert Error (batch pdf):', err.stack || err);
      }
    }
    const result = await dbPool.query('SELECT * FROM documents;');
    console.log('DB query result:', result.rows);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Batch PDF processing failed:', error.stack || error);
    res.status(500).json({ error: 'Batch PDF processing failed', details: error.message });
  }
});

// Fetch all data from the documents table as a single table
router.get('/all-documents', async (req, res) => {
  try {
    const result = await dbPool.query('SELECT * FROM documents;');
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Helper to ensure columns exist in the after_verify DB
afterVerifyPool.ensureColumns = async function(table, requiredColumns) {
  const cur = await afterVerifyPool.connect();
  try {
    const res = await cur.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}';`);
    const existing = new Set(res.rows.map(row => row.column_name));
    for (const col of requiredColumns) {
      if (!existing.has(col)) {
        await cur.query(`ALTER TABLE ${table} ADD COLUMN "${col}" TEXT;`);
      }
    }
  } finally {
    cur.release();
  }
};

// Helper to create table if not exists in after_verify DB
afterVerifyPool.createTableIfNotExists = async function(table, columns) {
  const colDefs = columns.map(k => `"${k}" TEXT`).join(', ');
  await afterVerifyPool.query(`CREATE TABLE IF NOT EXISTS ${table} (${colDefs});`);
};

module.exports = router;