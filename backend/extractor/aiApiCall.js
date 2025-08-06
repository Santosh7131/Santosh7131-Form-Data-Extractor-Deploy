const fs = require('fs');
const path = require('path');
const axios = require('axios');
const poppler = require('pdf-poppler');
require('dotenv').config();

/**
 * Azure OCR API configuration
 * TODO: Move these to environment variables for better security
 */
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT || 'https://santosh-ocr-api.cognitiveservices.azure.com/';
const AZURE_API_KEY = process.env.AZURE_API_KEY || '1gMnawu4bvcfPxefrGorXX4TJVjE8apKsG6z1uUQdKRmHBaUeFSaJQQJ99BFACGhslBXJ3w3AAAFACOGqdr1';

/**
 * Extracts text from an image using Azure's OCR API
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<string>} - Extracted text from the image
 * @throws {Error} If Azure OCR fails or times out
 */
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

    // Poll for results (max 15 seconds)
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

/**
 * Converts a PDF file to JPEG images (one per page)
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<{images: string[], outputDir: string}>} - Array of image paths and output directory
 * @throws {Error} If no images are generated
 */
async function pdfToImages(pdfPath) {
    const outputDir = path.join(path.dirname(pdfPath), path.basename(pdfPath, path.extname(pdfPath)) + '_images');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    
    const opts = {
        format: 'jpeg',
        out_dir: outputDir,
        out_prefix: 'page',
        page: null,
        jpegFile: true,
        resolution: 300,
    };
    
    await poppler.convert(pdfPath, opts);
    
    // Get all generated images
    const images = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'))
        .map(f => path.join(outputDir, f));
    
    if (images.length === 0) throw new Error('No images generated from PDF');
    return { images, outputDir };
}

/**
 * Groq AI API configuration for text structuring
 * TODO: Move API key to environment variables
 */
const API_KEY = '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';
const API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Extracts JSON from AI response text
 * @param {string} text - AI response text
 * @returns {Object|null} - Parsed JSON or null if parsing fails
 */
function extractJsonFromText(text) {
    // Try to extract JSON from code block
    const codeBlockMatch = text.match(/```[\s\S]*?({[\s\S]*?})[\s\S]*?```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
        try { return JSON.parse(codeBlockMatch[1]); } catch (e) {}
    }
    
    // Try to extract JSON directly
    const jsonMatch = text.match(/{[\s\S]*}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e) {}
    }
    
    return null;
}

/**
 * Processes extracted text with Groq AI to structure it into JSON format
 * @param {string} text - Raw text to process
 * @param {boolean} retry - Whether this is a retry attempt
 * @returns {Promise<Object>} - Structured data or error object
 */
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

/**
 * Main function to extract and structure text from an image
 * @param {string} filePath - Path to the image file
 * @returns {Promise<Object>} - Structured data from the image
 */
async function extractTextFromImage(filePath) {
    const rawText = await extractTextWithAzure(filePath);
    return processTextWithAI(rawText);
}

/**
 * Main function to extract and structure text from a scanned PDF
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<Object>} - Structured data from the PDF
 */
async function extractTextFromScannedPDF(pdfPath) {
    const { images, outputDir } = await pdfToImages(pdfPath);
    let allText = '';
    
    // Process each page
    for (const img of images) {
        const text = await extractTextWithAzure(img);
        allText += text + '\n';
    }
    
    // Clean up temporary images
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
