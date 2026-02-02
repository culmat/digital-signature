/**
 * Helpers for extracting text content from exported files (PDF and Word).
 */

const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * Extract text content from a PDF file.
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<string>} - Extracted text content
 */
async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Extract text content from a Word (.doc) file.
 * Confluence exports Word as MHTML format (HTML wrapped in MIME envelope).
 * @param {string} filePath - Path to the Word file
 * @returns {string} - Extracted text content
 */
function extractWordText(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Extract HTML body content from MHTML
  const htmlMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (htmlMatch) {
    // Strip HTML tags and normalize whitespace
    return htmlMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[^;]+;/g, ' ')  // Remove HTML entities
      .replace(/\s+/g, ' ')
      .trim();
  }

  return content;
}

module.exports = { extractPdfText, extractWordText };
