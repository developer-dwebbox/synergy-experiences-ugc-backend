const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const multer = require('multer');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Configure multer for handling FormData
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
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

// Function to get video duration
function getVideoDuration(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error('FFprobe duration error:', err);
        reject(err);
        return;
      }
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }
      resolve(videoStream.duration);
    });
  });
}

// Function to process video with frame overlay and background music
async function processVideo(inputPath, outputPath, audioPath, isMobile) {
  try {
    const dimensions = await getVideoDimensions(inputPath);
    const duration = await getVideoDuration(inputPath);
    
    // Select frame based on device type
    const framePath = isMobile ? 'assets/images/frame-mobile.png' : 'assets/images/frame-desktop.png';
    console.log('Using frame:', framePath);
    
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .input(framePath)
        .input(audioPath)
        .complexFilter([
          {
            filter: 'scale',
            options: {
              w: dimensions.width,
              h: dimensions.height,
              force_original_aspect_ratio: 'disable'
            },
            inputs: '1:v',
            outputs: 'scaled_frame'
          },
          {
            filter: 'overlay',
            options: {
              x: 0,
              y: 0,
              format: 'rgb'
            },
            inputs: ['0:v', 'scaled_frame'],
            outputs: 'framed_video'
          }
        ])
        .outputOptions([
          '-map [framed_video]',
          '-map 2:a',
          '-shortest',
          '-af', `volume=0.5`,
          '-pix_fmt yuv420p'
        ])
        .audioCodec('aac')
        .videoCodec('libx264')
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

// Route to handle video blob upload
router.post('/upload-blob', upload.single('video'), async (req, res) => {
  try {
    console.log(req.body)
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Create a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const inputPath = path.join('uploads', `input-${uniqueSuffix}.mp4`);
    const outputPath = path.join('uploads', `processed-${uniqueSuffix}.mp4`);

    // Write the buffer to a file
    fs.writeFileSync(inputPath, req.file.buffer);

    const isMobile = req.body.isMobile === 'true' || req.body.isMobile === true;
    const audioId = req.body.audioId;
    let audioPath = 'assets/audio/tractor_ace.wav'; // Default audio

    console.log('Received request:', {
      filename: `input-${uniqueSuffix}.mp4`,
      isMobile,
      audioId
    });

    if (audioId === '1') {
      audioPath = 'assets/audio/tractor.mp3';
    } else if (audioId === '2') {
      audioPath = 'assets/audio/ace.mp3';
    } else if (audioId === '3'){
      audioPath = 'assets/audio/tamil.wav';
    }else if (audioId === '4'){
      audioPath = 'assets/audio/telugu.wav';
    }else if (audioId === '5'){
      audioPath = 'assets/audio/kannada.wav';
    }

    // Process the video
    await processVideo(inputPath, outputPath, audioPath, isMobile);

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