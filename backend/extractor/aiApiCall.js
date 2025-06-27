const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { fromPath } = require('pdf2pic');
require('dotenv').config();

const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT || 'https://santosh-ocr-api.cognitiveservices.azure.com/';
const AZURE_API_KEY = process.env.AZURE_API_KEY || '1gMnawu4bvcfPxefrGorXX4TJVjE8apKsG6z1uUQdKRmHBaUeFSaJQQJ99BFACGhslBXJ3w3AAAFACOGqdr1';

// Helper: Call Azure OCR on an image file
async function extractTextWithAzure(imagePath) {
    const imageData = fs.readFileSync(imagePath);
    const url = `${AZURE_ENDPOINT.replace(/\/$/, '')}/vision/v3.2/read/analyze`;
    const response = await axios.post(url, imageData, {
        headers: {
            'Ocp-Apim-Subscription-Key': AZURE_API_KEY,
            'Content-Type': 'application/octet-stream',
        },
    });
    const operationLocation = response.headers['operation-location'];
    let result = null;
    for (let i = 0; i < 15; i++) {
        await new Promise(res => setTimeout(res, 1000));
        const resultResponse = await axios.get(operationLocation, {
            headers: { 'Ocp-Apim-Subscription-Key': AZURE_API_KEY },
        });
        if (resultResponse.data.status === 'succeeded') {
            result = resultResponse.data.analyzeResult.readResults
                .map(page => page.lines.map(line => line.text).join('\n'))
                .join('\n');
            break;
        }
        if (resultResponse.data.status === 'failed') {
            throw new Error('Azure OCR failed');
        }
    }
    if (!result) throw new Error('Azure OCR did not complete in time');
    return result;
}

// Helper: Convert PDF to images (one per page) using pdf2pic
async function pdfToImages(pdfPath) {
    const outputDir = path.join(path.dirname(pdfPath), path.basename(pdfPath, path.extname(pdfPath)) + '_images');
    
    // Clean up existing directory if it exists
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    
    // Create fresh directory
    fs.mkdirSync(outputDir, { recursive: true });
    
    const options = {
        density: 300,           // output pixels per inch
        saveFilename: "page",   // output filename
        savePath: outputDir,    // output path
        format: "jpeg",         // output format
        width: 2048,           // output width
        height: 2048           // output height
    };
    
    try {
        const convert = fromPath(pdfPath, options);
        const pageData = await convert.bulk(-1); // convert all pages
        
        // Wait a moment for files to be written
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get all generated images
        const images = fs.readdirSync(outputDir)
            .filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'))
            .map(f => path.join(outputDir, f))
            .sort(); // Ensure consistent order
        
        if (images.length === 0) throw new Error('No images generated from PDF');
        return { images, outputDir };
    } catch (error) {
        // Clean up on error
        if (fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
        throw new Error(`PDF conversion failed: ${error.message}`);
    }
}

// AI structuring logic (unchanged)
const API_KEY = process.env.API_KEY;
const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'; 
function extractJsonFromText(text) {
    const codeBlockMatch = text.match(/```[\s\S]*?({[\s\S]*?})[\s\S]*?```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
        try { return JSON.parse(codeBlockMatch[1]); } catch (e) {}
    }
    const jsonMatch = text.match(/{[\s\S]*}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e) {}
    }
    return null;
}
async function processTextWithAI(text, retry = true) {
    try {
        const requestBody = {
            model: "llama3-70b-8192",
            messages: [
                {
                    role: "system",
                    content: `You are an AI trained to analyze and structure extracted text. You now need to extract key value pairs from the given text and categrorize them into a JSON format. The text may contain various symbols, white spaces, and other artifacts due to OCR extraction. Check if the data makes sense because ocr often extracts meaningless data . Focus on identifying meaningful key-value pairs. Your output should strictly only be in a json format, without any additional text or explanations.`
                },
                {
                    role: "user",
                    content: `This is my input data, it is extracted from a pdf file which is a form like bank registration form or any other form. I have used ocr to extract the text from the form. Since it's ocr it may have many problems like useless symbols, white spaces and stuff at random locations.\n${text}`
                }
            ],
            temperature: 0.5,
            max_tokens: 1024
        };
        const requestHeaders = {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        };
        const response = await axios.post(API_ENDPOINT, requestBody, { headers: requestHeaders });
        try {
            let aiResponse = response.data.choices[0].message.content;
            const extracted = extractJsonFromText(aiResponse);
            if (extracted) return extracted;
            if (retry) {
                console.warn('Groq response not in JSON format, retrying once...');
                return await processTextWithAI(text, false);
            }
            return {
                raw_text: text,
                structured_data: aiResponse,
                error: "Response was not in JSON format"
            };
        } catch (parseError) {
            if (retry) {
                console.warn('Groq response parse error, retrying once...');
                return await processTextWithAI(text, false);
            }
            return {
                raw_text: text,
                structured_data: response.data.choices[0].message.content,
                error: "Response was not in JSON format"
            };
        }
    } catch (error) {
        console.error('API Processing Error:', error.message);
        throw new Error('Failed to process text with AI model: ' + error.message);
    }
}

// Main: Extract text from image (Azure)
async function extractTextFromImage(filePath) {
    const rawText = await extractTextWithAzure(filePath);
    return processTextWithAI(rawText);
}

// Main: Extract text from PDF (convert to images, then Azure)
async function extractTextFromScannedPDF(pdfPath) {
    const { images, outputDir } = await pdfToImages(pdfPath);
    let allText = '';
    for (const img of images) {
        const text = await extractTextWithAzure(img);
        allText += text + '\n';
    }
    // Clean up images after processing
    for (const img of images) {
        if (fs.existsSync(img)) fs.unlinkSync(img);
    }
    if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir, { recursive: true });
    return processTextWithAI(allText);
}

module.exports = {
    extractTextFromImage,
    extractTextFromScannedPDF
};
