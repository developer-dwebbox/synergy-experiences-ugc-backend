const express = require('express');
const multer = require('multer');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const cors = require('cors');
const fs = require('fs');

// Set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Import routes
const blobUploadRouter = require('./routes/blob-upload');

// CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 86400
};

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure uploads directory exists
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads', { recursive: true });
    }
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
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
app.use(cors(corsOptions));
app.use(express.json({ limit: '100mb' })); // Increase JSON payload limit for blob uploads

// Routes
app.use('/api', blobUploadRouter);

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Asian Paints UGGC API' });
});

/**
 * Get detailed video information using FFprobe
 * @param {string} inputPath - Path to the input video file
 * @returns {Promise<Object>} - Video information including dimensions, file size, and duration
 */
function getVideoInfo(inputPath) {
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

      // Get file size
      const fileSize = metadata.format.size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      console.log('Input Video Info:', {
        width: videoStream.width,
        height: videoStream.height,
        fileSize: `${fileSizeMB} MB`,
        duration: metadata.format.duration,
        codec: videoStream.codec_name
      });

      resolve({
        width: videoStream.width,
        height: videoStream.height,
        fileSize,
        duration: metadata.format.duration,
        codec: videoStream.codec_name
      });
    });
  });
}

/**
 * Get video duration
 * @param {string} inputPath - Path to the input video file
 * @returns {Promise<number>} - Duration in seconds
 */
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
      
      // Prefer duration from video stream, fall back to format duration
      const duration = videoStream.duration || metadata.format.duration;
      resolve(duration);
    });
  });
}

/**
 * Process video with frame overlay and background music
 * @param {string} inputPath - Path to the input video file
 * @param {string} outputPath - Path for the output video file
 * @param {string} audioPath - Path to the audio file to mix
 * @param {boolean} isDesktop - Whether to use desktop or mobile frame
 * @returns {Promise<void>} - Resolves when processing is complete
 */
async function processVideo(inputPath, outputPath, audioPath, isDesktop) {
  try {
    // Get video information and duration
    const videoInfo = await getVideoInfo(inputPath);
    const duration = await getVideoDuration(inputPath);
    
    // Select frame based on device type
    const framePath = isDesktop ? 'assets/images/frame-desktop.png' : 'assets/images/frame-mobile.png';
    console.log(`Using frame: ${framePath} for ${isDesktop ? 'desktop' : 'mobile'} mode`);
    
    return new Promise((resolve, reject) => {
      let errorOccurred = false;
      let lastProgress = 0;
      let progressTimeout;

      // Create ffmpeg command with input sources
      const command = ffmpeg(inputPath)
        .input(framePath)
        .inputOptions(['-loop 1']) // Loop the frame image
        .input(audioPath);

      // Set up complex filter for video processing
      command
        .complexFilter([
          // Scale frame to match video dimensions
          {
            filter: 'scale',
            options: {
              w: videoInfo.width,
              h: videoInfo.height,
              force_original_aspect_ratio: 'disable'
            },
            inputs: '1:v', // Second input (frame)
            outputs: 'scaled_frame'
          },
          // Prepare main video with timestamps
          {
            filter: 'setpts',
            options: 'PTS-STARTPTS',
            inputs: '0:v', // First input (video)
            outputs: 'main_video'
          },
          // Prepare frame with timestamps
          {
            filter: 'setpts',
            options: 'PTS-STARTPTS',
            inputs: 'scaled_frame',
            outputs: 'frame_video'
          },
          // Overlay frame on video
          {
            filter: 'overlay',
            options: {
              x: 0,
              y: 0,
              shortest: 1,
              eof_action: 'repeat',
              enable: 'between(t,0,999999)' // Apply for entire duration
            },
            inputs: ['main_video', 'frame_video'],
            outputs: 'framed_video'
          }
        ])
        .outputOptions([
          '-map [framed_video]', // Use the framed video output
          '-map 2:a',            // Use the third input's audio (background music)
          '-af', 'volume=0.5',   // Reduce audio volume to 50%
          '-pix_fmt yuv420p',    // Standard pixel format for compatibility
          '-preset slow',        // Better compression
          '-crf 23',             // Balance between quality and file size
          '-movflags +faststart', // Optimize for web streaming
          '-profile:v high',     // High profile for better quality
          '-level 4.0',          // Compatibility level
          '-max_muxing_queue_size 1024', // Increase queue size for complex processing
          '-vsync 1'             // Video synchronization method
        ])
        .audioCodec('aac')       // Standard audio codec
        .videoCodec('libx264')   // Standard video codec
        .on('start', (commandLine) => {
          console.log('Started FFmpeg with command:', commandLine);
          console.log('Input video duration:', duration, 'seconds');
          
          // Set a timeout to check for stalled progress
          progressTimeout = setInterval(() => {
            if (lastProgress === 0) {
              console.log('Warning: No progress detected for 30 seconds');
              console.log('Checking input file:', {
                exists: fs.existsSync(inputPath),
                size: fs.statSync(inputPath).size
              });
            }
          }, 30000);
        })
        .on('progress', (progress) => {
          if (progress.percent !== undefined) {
            lastProgress = progress.percent;
            console.log('Processing:', `${Math.round(progress.percent)}% done`, {
              frames: progress.frames,
              currentFps: progress.currentFps,
              targetSize: progress.targetSize,
              timemark: progress.timemark
            });
          }
        })
        .on('stderr', (stderrLine) => {
          console.log('FFmpeg stderr:', stderrLine);
        })
        .on('error', (err) => {
          errorOccurred = true;
          clearInterval(progressTimeout);
          console.error('FFmpeg error details:', {
            message: err.message,
            code: err.code,
            signal: err.signal,
            killed: err.killed,
            cmd: err.cmd,
            stdout: err.stdout,
            stderr: err.stderr
          });
          reject(err);
        })
        .on('end', () => {
          clearInterval(progressTimeout);
          
          if (errorOccurred) {
            console.error('Processing ended with errors');
            return;
          }

          try {
            // Verify output file exists and has content
            if (!fs.existsSync(outputPath)) {
              throw new Error('Output file was not created');
            }

            const outputStats = fs.statSync(outputPath);
            if (outputStats.size === 0) {
              throw new Error('Output file is empty');
            }

            // Get output file size
            const outputFileSize = outputStats.size;
            const outputFileSizeMB = (outputFileSize / (1024 * 1024)).toFixed(2);
            
            console.log('Output Video Info:', {
              width: videoInfo.width,
              height: videoInfo.height,
              fileSize: `${outputFileSizeMB} MB`,
              duration: videoInfo.duration,
              compressionRatio: `${((outputFileSize / videoInfo.fileSize) * 100).toFixed(2)}%`
            });
            
            console.log('Video processing finished successfully');
            resolve();
          } catch (error) {
            console.error('Error verifying output file:', error);
            reject(error);
          }
        })
        .save(outputPath);
    });
  } catch (error) {
    console.error('Process video error:', error);
    throw error;
  }
}

/**
 * Handle video upload and processing
 */
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const inputPath = req.file.path;
    const outputPath = path.join('uploads', `processed-${req.file.filename}`);
    
    // Parse request parameters
    const isDesktop = req.body.isDesktop === 'true';
    const audioId = req.body.audioId || '1';
    let audioPath = 'assets/audio/jingle-dummy.wav'; // Default audio

    console.log('Received upload request:', {
      filename: req.file.filename,
      isDesktop,
      audioId,
      originalSize: `${(req.file.size / (1024 * 1024)).toFixed(2)} MB`
    });

    // Select audio based on audioId
    if (audioId === '1') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    } else if (audioId === '2') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    } else if (audioId === '3') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    }

    // Process the video
    await processVideo(inputPath, outputPath, audioPath, isDesktop);
    console.log('Video processing completed successfully');

    // Delete the original uploaded file to save space
    try {
      fs.unlinkSync(inputPath);
      console.log('Original file deleted:', inputPath);
    } catch (err) {
      console.error('Error deleting original file:', err);
    }

    // Set appropriate headers for video file download
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(outputPath)}`);

    // Send the processed video file
    res.sendFile(path.resolve(outputPath), (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: 'Error sending processed video' });
      } else {
        console.log('File sent successfully:', outputPath);
        
        // Delete the processed file after sending to save space
        try {
          fs.unlinkSync(outputPath);
          console.log('Processed file deleted after sending:', outputPath);
        } catch (err) {
          console.error('Error deleting processed file:', err);
        }
      }
    });
  } catch (error) {
    console.error('Upload route error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error middleware caught:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Video file size too large. Maximum size is 100MB' });
    }
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  
  res.status(500).json({ error: err.message });
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
  console.log('Created uploads directory');
}

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`FFmpeg path: ${ffmpegPath}`);
  console.log(`FFprobe path: ${ffprobePath}`);
});