const express = require('express');
const multer = require('multer');
const pdf2img = require('pdf2img');
const Tesseract = require('tesseract.js');
const cors = require("cors");
const util = require('util');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

const convertAsync = util.promisify(pdf2img.convert);

app.post('/convert', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const pdfPath = req.file.path;
  const outputDir = 'converted_images/';

  try {
    const result = await convertAsync(pdfPath);
    const images = result.map(img => `${outputDir}${img}`);

    // Perform OCR on the converted images to extract text
    const extractedText = await performOCR(images);

    // You need to implement your logic to extract the IBM Agreement Number from the extracted text
    const ibmAgreementNumber = extractIBMNumber(extractedText);

    res.json({ images, ibmAgreementNumber });
  } catch (error) {
    console.error('Error converting PDF to images:', error);
    res.status(500).json({ error: 'Failed to convert PDF to images' });
  }
});

async function performOCR(images) {
  const worker = Tesseract.createWorker({
    logger: m => console.log(m)
  });
  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const results = [];
  for (const image of images) {
    const { data: { text } } = await worker.recognize(image);
    results.push(text);
  }

  await worker.terminate();
  return results;
}

function extractIBMNumber(texts) {
  // Implement your logic to extract IBM Agreement Number from the extracted texts
  // Example: Regular expression or string manipulation
  // For simplicity, let's assume the first line contains the IBM Agreement Number
  return texts[0];
}

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
