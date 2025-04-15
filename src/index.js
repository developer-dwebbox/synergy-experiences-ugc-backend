const express = require('express');
const multer = require('multer');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Generate a unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for videos
  },
  fileFilter: function (req, file, cb) {
    // Accept only video files
    const filetypes = /mp4|mov|avi|wmv|flv|mkv|webm/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only video files are allowed! Supported formats: mp4, mov, avi, wmv, flv, mkv, webm'));
  }
});

// Middleware
app.use(express.json());

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Asian Paints UGGC API' });
});

// Function to get video dimensions
function getVideoDimensions(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error('FFprobe error:', err);
        reject(err);
        return;
      }
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }
      console.log('Video dimensions:', {
        width: videoStream.width,
        height: videoStream.height
      });
      resolve({
        width: videoStream.width,
        height: videoStream.height
      });
    });
  });
}

// Function to process video with frame overlay
async function processVideo(inputPath, outputPath) {
  try {
    // Get video dimensions
    const dimensions = await getVideoDimensions(inputPath);
    
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .input('assets/images/frame-mobile.png') // Frame overlay image
        .complexFilter([
          // Scale the frame to match video dimensions exactly
          {
            filter: 'scale',
            options: {
              w: dimensions.width,
              h: dimensions.height,
              force_original_aspect_ratio: 'disable' // Disable aspect ratio preservation
            },
            inputs: '1:v',
            outputs: 'scaled_frame'
          },
          // Overlay the scaled frame
          {
            filter: 'overlay',
            options: {
              x: 0,
              y: 0,
              format: 'rgb' // Ensure proper color format
            },
            inputs: ['0:v', 'scaled_frame']
          }
        ])
        .audioCodec('aac')
        .videoCodec('libx264')
        .outputOptions([
          '-map 0:v',
          '-map 0:a',
          '-shortest',
          '-pix_fmt yuv420p' // Ensure compatible pixel format
        ])
        .on('end', () => {
          console.log('Video processing finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .save(outputPath);
    });
  } catch (error) {
    console.error('Process video error:', error);
    throw error;
  }
}

// File upload route
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const inputPath = req.file.path;
    const outputPath = path.join('uploads', `processed-${req.file.filename}`);

    // Process the video
    await processVideo(inputPath, outputPath);

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

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Video file size too large. Maximum size is 100MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 