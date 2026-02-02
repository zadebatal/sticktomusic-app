import React, { useRef, useEffect, useState, useCallback } from 'react';

const VideoPreview = ({
  videoSrc,
  audioSrc,
  currentTime,
  onTimeUpdate,
  isPlaying,
  onPlayPause,
  visibleWords = [],
  textStyle = {}
}) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);

  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 360, height: 640 });

  // Sync video and audio playback
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    if (isPlaying) {
      if (video?.paused) {
        const vp = video.play();
        if (vp) vp.catch(() => {});
      }
      if (audio?.paused) {
        const ap = audio.play();
        if (ap) ap.catch(() => {});
      }
    } else {
      if (video && !video.paused) video.pause();
      if (audio && !audio.paused) audio.pause();
    }
  }, [isPlaying]);

  // Sync time between video and audio
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    if (video && Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime;
    }
    if (audio && Math.abs(audio.currentTime - currentTime) > 0.1) {
      audio.currentTime = currentTime;
    }
  }, [currentTime]);

  // Animation loop for canvas rendering
  useEffect(() => {
    const render = () => {
      drawOverlay();
      animationRef.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationRef.current);
  }, [visibleWords, textStyle]);

  // Handle video metadata loaded
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);

      // Calculate dimensions for 9:16 aspect ratio preview
      const aspectRatio = video.videoWidth / video.videoHeight;
      const containerHeight = 640;
      const containerWidth = containerHeight * aspectRatio;
      setDimensions({
        width: Math.min(containerWidth, 360),
        height: Math.min(containerHeight, 640)
      });
    }
  }, []);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      onTimeUpdate(videoRef.current.currentTime);
    }
  }, [onTimeUpdate]);

  // Seek to time
  const handleSeek = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;

    if (videoRef.current) videoRef.current.currentTime = newTime;
    if (audioRef.current) audioRef.current.currentTime = newTime;
    onTimeUpdate(newTime);
  }, [duration, onTimeUpdate]);

  // Draw text overlays on canvas
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw each visible word
    visibleWords.forEach(word => {
      const {
        fontSize = 60,
        fontFamily = 'sans-serif',
        color = '#ffffff',
        outline = true,
        outlineColor = '#000000',
        outlineWidth = 2,
        textCase = 'default',
        position = { x: 'center', y: 'center' }
      } = textStyle;

      // Apply text case
      let displayText = word.text;
      if (textCase === 'upper') displayText = displayText.toUpperCase();
      if (textCase === 'lower') displayText = displayText.toLowerCase();

      // Set font
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Calculate position
      let x = width / 2;
      let y = height / 2;

      if (typeof position.x === 'number') x = position.x;
      if (typeof position.y === 'number') y = position.y;

      // Draw outline first
      if (outline) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(displayText, x, y);
      }

      // Draw fill
      ctx.fillStyle = color;
      ctx.fillText(displayText, x, y);
    });
  }, [visibleWords, textStyle]);

  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div ref={containerRef} style={styles.container}>
      {/* Video Element */}
      <div style={styles.videoWrapper}>
        <video
          ref={videoRef}
          src={videoSrc}
          style={styles.video}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          muted={audioSrc ? true : isMuted} // Mute video if separate audio track
          playsInline
        />

        {/* Canvas Overlay for text */}
        <canvas
          ref={canvasRef}
          width={1080}
          height={1920}
          style={{
            ...styles.canvas,
            width: dimensions.width,
            height: dimensions.height
          }}
        />
      </div>

      {/* Audio Element (if separate audio track) */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          muted={isMuted}
        />
      )}

      {/* Controls */}
      <div style={styles.controls}>
        {/* Play/Pause Button */}
        <button onClick={onPlayPause} style={styles.playButton}>
          {isPlaying ? '⏸' : '▶️'}
        </button>

        {/* Progress Bar */}
        <div style={styles.progressContainer} onClick={handleSeek}>
          <div
            style={{
              ...styles.progressBar,
              width: `${(currentTime / duration) * 100}%`
            }}
          />
        </div>

        {/* Time Display */}
        <span style={styles.timeDisplay}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Mute Button */}
        <button onClick={() => setIsMuted(!isMuted)} style={styles.muteButton}>
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    width: '100%'
  },
  videoWrapper: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    aspectRatio: '9/16',
    maxHeight: '500px'
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    pointerEvents: 'none'
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '8px',
    backgroundColor: '#1e293b',
    borderRadius: '8px'
  },
  playButton: {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer'
  },
  progressContainer: {
    flex: 1,
    height: '6px',
    backgroundColor: '#334155',
    borderRadius: '3px',
    cursor: 'pointer',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: '3px',
    transition: 'width 0.1s'
  },
  timeDisplay: {
    fontSize: '12px',
    color: '#94a3b8',
    minWidth: '80px',
    textAlign: 'center'
  },
  muteButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '16px',
    cursor: 'pointer'
  }
};

export default VideoPreview;
