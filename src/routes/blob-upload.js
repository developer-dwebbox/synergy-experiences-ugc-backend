const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const multer = require('multer');

// Configure multer for handling FormData
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Function to get video duration
function getVideoDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('FFprobe error:', error);
        reject(error);
        return;
      }
      resolve(parseFloat(stdout));
    });
  });
}

// Function to process video with background music
async function processVideo(inputPath, outputPath, audioPath) {
  try {
    const duration = await getVideoDuration(inputPath);
    console.log('Video duration:', duration);

    return new Promise((resolve, reject) => {
      const command = `ffmpeg -i "${inputPath}" -stream_loop -1 -i "${audioPath}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t ${duration} "${outputPath}"`;
      
      console.log('Executing FFmpeg command:', command);
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('FFmpeg error:', error);
          reject(error);
          return;
        }
        console.log('Video processing finished');
        resolve();
      });
    });
  } catch (error) {
    console.error('Process video error:', error);
    throw error;
  }
}

// Route to handle video upload
router.post('/upload-blob', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Create a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const inputPath = path.join('uploads', `input-${uniqueSuffix}.mp4`);
    const outputPath = path.join('uploads', `processed-${uniqueSuffix}.mp4`);

    // Write the buffer to a file
    fs.writeFileSync(inputPath, req.file.buffer);

    const audioId = req.body.audioId;
    let audioPath = 'assets/audio/jingle-dummy.wav'; // Default audio

    console.log('Received request:', {
      filename: `input-${uniqueSuffix}.mp4`,
      audioId
    });

    if (audioId === '1') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    } else if (audioId === '2') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    } else if (audioId === '3') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    }

    // Process the video with background music
    await processVideo(inputPath, outputPath, audioPath);

    // Delete the original uploaded file
    fs.unlinkSync(inputPath);

    // Set appropriate headers for video file
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(outputPath)}`);

    // Send the processed video file
    res.sendFile(path.resolve(outputPath), (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: 'Error sending processed video' });
      } else {
        // Delete the processed file after sending
        fs.unlinkSync(outputPath);
      }
    });
  } catch (error) {
    console.error('Upload route error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 