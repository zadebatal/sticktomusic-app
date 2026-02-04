import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * PreviewPlayer - Plays a video "recipe" without rendering
 *
 * Instead of rendering clips into a single video file, this component
 * plays source clips in sequence according to the timeline, giving
 * users an instant preview of how their video will look.
 */
const PreviewPlayer = ({
  clips = [],
  audio = null,
  duration = 30,
  autoPlay = false,
  showControls = true,
  style = {}
}) => {
  const containerRef = useRef(null);
  const audioRef = useRef(null);
  const videoRefs = useRef({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const animationRef = useRef(null);
  const startTimeRef = useRef(null);

  // Get the URL for a clip (prefer cloud over blob)
  const getClipUrl = useCallback((clip) => {
    const localUrl = clip.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? clip.url : (localUrl || clip.url);
  }, []);

  // Find which clip should be playing at a given time
  const getClipAtTime = useCallback((time) => {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const clipEnd = clip.startTime + clip.duration;
      if (time >= clip.startTime && time < clipEnd) {
        return { clip, index: i, localTime: time - clip.startTime };
      }
    }
    // Default to last clip if past end
    if (clips.length > 0) {
      const lastClip = clips[clips.length - 1];
      return {
        clip: lastClip,
        index: clips.length - 1,
        localTime: lastClip.duration
      };
    }
    return null;
  }, [clips]);

  // Animation loop for playback
  const animate = useCallback((timestamp) => {
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp;
    }

    const elapsed = (timestamp - startTimeRef.current) / 1000;
    const newTime = Math.min(elapsed, duration);

    setCurrentTime(newTime);

    // Find current clip
    const clipInfo = getClipAtTime(newTime);
    if (clipInfo) {
      setCurrentClipIndex(clipInfo.index);

      // Sync video element to clip time
      const videoEl = videoRefs.current[clipInfo.clip.id];
      if (videoEl && Math.abs(videoEl.currentTime - clipInfo.localTime) > 0.2) {
        videoEl.currentTime = clipInfo.localTime;
      }
    }

    // Continue or stop
    if (newTime < duration && isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    } else if (newTime >= duration) {
      setIsPlaying(false);
      setCurrentTime(0);
      startTimeRef.current = null;
    }
  }, [duration, getClipAtTime, isPlaying]);

  // Start/stop playback
  useEffect(() => {
    if (isPlaying) {
      // Start audio
      if (audioRef.current) {
        const audioStart = audio?.startTime || 0;
        audioRef.current.currentTime = audioStart + currentTime;
        audioRef.current.play().catch(() => {});
      }

      // Start animation loop
      startTimeRef.current = null;
      animationRef.current = requestAnimationFrame(animate);
    } else {
      // Stop
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, animate, audio, currentTime]);

  // Auto-play on mount if requested
  useEffect(() => {
    if (autoPlay && clips.length > 0) {
      setIsPlaying(true);
    }
  }, [autoPlay, clips.length]);

  // Toggle play/pause
  const togglePlay = () => {
    if (!isPlaying) {
      startTimeRef.current = null;
    }
    setIsPlaying(!isPlaying);
  };

  // Seek to position
  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;

    setCurrentTime(newTime);
    startTimeRef.current = performance.now() - (newTime * 1000);

    // Update clip
    const clipInfo = getClipAtTime(newTime);
    if (clipInfo) {
      setCurrentClipIndex(clipInfo.index);
    }

    // Sync audio
    if (audioRef.current) {
      const audioStart = audio?.startTime || 0;
      audioRef.current.currentTime = audioStart + newTime;
    }
  };

  // Get audio URL
  const getAudioUrl = () => {
    if (!audio) return null;
    const localUrl = audio.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? audio.url : (localUrl || audio.url);
  };

  const currentClip = clips[currentClipIndex];
  const progress = (currentTime / duration) * 100;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '9/16',
        background: '#000',
        borderRadius: '8px',
        overflow: 'hidden',
        ...style
      }}
    >
      {/* Hidden video elements for all clips (preloaded) */}
      {clips.map((clip, idx) => (
        <video
          key={clip.id}
          ref={el => videoRefs.current[clip.id] = el}
          src={getClipUrl(clip)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: idx === currentClipIndex ? 1 : 0,
            transition: 'opacity 0.1s'
          }}
          muted
          playsInline
          preload="auto"
        />
      ))}

      {/* Audio element */}
      {audio && (
        <audio
          ref={audioRef}
          src={getAudioUrl()}
          preload="auto"
        />
      )}

      {/* Play/Pause overlay */}
      <div
        onClick={togglePlay}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: isPlaying ? 'transparent' : 'rgba(0,0,0,0.3)'
        }}
      >
        {!isPlaying && (
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(139, 92, 246, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px'
          }}>
            ▶
          </div>
        )}
      </div>

      {/* Controls */}
      {showControls && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))'
        }}>
          {/* Progress bar */}
          <div
            onClick={handleSeek}
            style={{
              height: '4px',
              background: 'rgba(255,255,255,0.3)',
              borderRadius: '2px',
              cursor: 'pointer',
              marginBottom: '8px'
            }}
          >
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: '#8b5cf6',
              borderRadius: '2px',
              transition: 'width 0.1s linear'
            }} />
          </div>

          {/* Time display */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'rgba(255,255,255,0.7)'
          }}>
            <span>{formatTime(currentTime)}</span>
            <span>Clip {currentClipIndex + 1}/{clips.length}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {/* No clips message */}
      {clips.length === 0 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#71717a'
        }}>
          No clips to preview
        </div>
      )}
    </div>
  );
};

// Format time as M:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default PreviewPlayer;
