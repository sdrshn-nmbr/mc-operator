const fs = require('fs');
const https = require('https');
const path = require('path');

/**
 * Downloads a PDF file from a signed S3 URL
 * @param {string} url - The signed S3 URL to download
 * @param {string} outputPath - Path to save the downloaded file
 * @returns {Promise<string>} - Resolves with a success message
 */
function downloadPdf(url, outputPath = 'downloaded.pdf') {
  return new Promise((resolve, reject) => {
    console.log(`Starting download from S3...`);
    console.log(`URL length: ${url.length} characters`);
    console.log(`Saving to: ${outputPath}`);

    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create a write stream to save the file
    const fileStream = fs.createWriteStream(outputPath);
    
    // Set a timeout for the entire download (90 seconds)
    const downloadTimeout = setTimeout(() => {
      request.destroy();
      fileStream.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(new Error('Download timed out after 90 seconds. The S3 URL may have expired.'));
    }, 90000);
    
    // Make the HTTP request
    const request = https.get(url, (response) => {
      // Check if the request was successful
      if (response.statusCode !== 200) {
        clearTimeout(downloadTimeout);
        fileStream.close();
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        reject(new Error(`Failed to download PDF. Status code: ${response.statusCode}`));
        return;
      }

      // Track download progress
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastLoggedPercentage = 0;

      // Pipe the response to the file stream
      response.pipe(fileStream);

      // Track progress if content length is available
      if (totalBytes > 0) {
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percentage = Math.floor((downloadedBytes / totalBytes) * 100);
          
          // Log progress every 10%
          if (percentage >= lastLoggedPercentage + 10) {
            console.log(`Download progress: ${percentage}%`);
            lastLoggedPercentage = percentage;
          }
        });
      }

      // Handle completion
      fileStream.on('finish', () => {
        clearTimeout(downloadTimeout);
        fileStream.close();
        
        // Verify file exists and has content
        fs.stat(outputPath, (err, stats) => {
          if (err) {
            reject(new Error(`Failed to verify downloaded file: ${err.message}`));
            return;
          }
          
          if (stats.size === 0) {
            fs.unlinkSync(outputPath);
            reject(new Error('Downloaded file is empty'));
            return;
          }
          
          const message = `Download complete! File saved to: ${outputPath} (${(stats.size / 1024).toFixed(2)} KB)`;
          console.log(message);
          resolve(message);
        });
      });
    });

    // Handle request errors
    request.on('error', (err) => {
      clearTimeout(downloadTimeout);
      fileStream.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      // Special handling for common S3 errors
      if (err.code === 'ENOTFOUND') {
        reject(new Error('Cannot reach S3 server. Check your internet connection.'));
      } else if (err.code === 'ETIMEDOUT') {
        reject(new Error('Connection to S3 timed out. The URL may have expired.'));
      } else {
        reject(new Error(`Error downloading file: ${err.message}`));
      }
    });

    // Set a timeout for the connection (15 seconds)
    request.setTimeout(15000, () => {
      request.destroy();
      clearTimeout(downloadTimeout);
      fileStream.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(new Error('Connection timed out. The S3 URL may have expired.'));
    });
  });
}

// If called directly from command line
if (require.main === module) {
  // Get URL from command line arguments
  const url = process.argv[2];
  const outputFile = process.argv[3] || 'downloaded.pdf';
  
  if (!url) {
    console.error('Error: No URL provided.');
    console.log('Usage: node download-pdf.js <S3_SIGNED_URL> [output_filename]');
    process.exit(1);
  }

  downloadPdf(url, outputFile)
    .then(message => {
      console.log(message);
      process.exit(0);
    })
    .catch(error => {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    });
} else {
  // Export for use as a module
  module.exports = { downloadPdf };
} 