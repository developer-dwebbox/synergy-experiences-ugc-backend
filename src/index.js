const express = require('express');
const multer = require('multer');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const cors = require('cors');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 5000;

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
app.use(express.json());

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Asian Paints UGGC API' });
});

// Function to get video dimensions
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
        duration: metadata.format.duration
      });

      resolve({
        width: videoStream.width,
        height: videoStream.height,
        fileSize,
        duration: metadata.format.duration
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
async function processVideo(inputPath, outputPath, audioPath, isDesktop) {
  try {
    const videoInfo = await getVideoInfo(inputPath);
    const duration = await getVideoDuration(inputPath);
    
    // Select frame based on device type
    const framePath = isDesktop ? 'assets/images/frame-mobile.png' : 'assets/images/frame-desktop.png';
    console.log('Using frame:', framePath);
    
    return new Promise((resolve, reject) => {
      let errorOccurred = false;
      let lastProgress = 0;
      let progressTimeout;

      const command = ffmpeg(inputPath)
        .input(framePath)
        // .inputOptions(['-stream_loop -1']) // Loop the frame image
        .input(audioPath);

      command
        .complexFilter([
          {
            filter: 'scale',
            options: {
              w: videoInfo.width,
              h: videoInfo.height,
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
              format: 'rgb',
              eval: 'init' // Initialize overlay filter
            },
            inputs: ['0:v', 'scaled_frame'],
            outputs: 'framed_video'
          }
        ])
        .outputOptions([
          '-map [framed_video]',
          '-map 2:a',
          '-af', `volume=0.5`,
          '-pix_fmt yuv420p',
          '-preset slow',
          '-crf 23',
          '-movflags +faststart',
          '-profile:v high',
          '-level 4.0',
          '-max_muxing_queue_size 1024',
          '-vsync 1'
        ])
        .audioCodec('aac')
        .videoCodec('libx264')
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

// File upload route
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const inputPath = req.file.path;
    const outputPath = path.join('uploads', `processed-${req.file.filename}`);
    const isDesktop = false;
    const audioId = req.body.audioId;
    let audioPath = 'assets/audio/jingle-dummy.wav'; // Default audio

    console.log('Received request:', {
      filename: req.file.filename,
      isDesktop,
      audioId
    });

    if (audioId === '1') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    } else if (audioId === '2') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    } else if (audioId === '3') {
      audioPath = 'assets/audio/jingle-dummy.wav';
    }

    // Process the video
    await processVideo(inputPath, outputPath, audioPath, isDesktop);

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