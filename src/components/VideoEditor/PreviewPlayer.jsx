import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import log from '../../utils/logger';

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
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const audioRef = useRef(null);
  const videoRefs = useRef([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const animationRef = useRef(null);
  const startTimeRef = useRef(null);
  const isPlayingRef = useRef(false); // Use ref to avoid stale closure

  // Get the URL for a clip (prefer cloud over blob)
  const getClipUrl = useCallback((clip) => {
    if (!clip) return null;
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
    // Default to first clip if before start or last clip if past end
    if (clips.length > 0) {
      if (time <= 0) {
        return { clip: clips[0], index: 0, localTime: 0 };
      }
      const lastClip = clips[clips.length - 1];
      return {
        clip: lastClip,
        index: clips.length - 1,
        localTime: Math.min(time - lastClip.startTime, lastClip.duration)
      };
    }
    return null;
  }, [clips]);

  // Get audio URL
  const getAudioUrl = useCallback(() => {
    if (!audio) return null;
    const localUrl = audio.localUrl;
    const isBlobUrl = localUrl && localUrl.startsWith('blob:');
    return isBlobUrl ? audio.url : (localUrl || audio.url);
  }, [audio]);

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
      const prevIndex = currentClipIndex;
      setCurrentClipIndex(clipInfo.index);

      // Play current video, pause others
      videoRefs.current.forEach((videoEl, idx) => {
        if (!videoEl) return;

        if (idx === clipInfo.index) {
          // This is the active clip - make sure it's playing
          const targetTime = clipInfo.localTime % (videoEl.duration || 999);

          // Seek if needed
          if (Math.abs(videoEl.currentTime - targetTime) > 0.3) {
            videoEl.currentTime = targetTime;
          }

          // Play if paused
          if (videoEl.paused) {
            videoEl.play().catch(() => {}); // Ignore autoplay errors
          }
        } else {
          // Pause non-active clips
          if (!videoEl.paused) {
            videoEl.pause();
          }
        }
      });
    }

    // Continue or stop
    if (newTime < duration && isPlayingRef.current) {
      animationRef.current = requestAnimationFrame(animate);
    } else if (newTime >= duration) {
      // Stop all videos
      videoRefs.current.forEach(videoEl => {
        if (videoEl && !videoEl.paused) videoEl.pause();
      });
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentClipIndex(0);
      startTimeRef.current = null;
    }
  }, [duration, getClipAtTime, currentClipIndex]);

  // Start playback
  const startPlayback = useCallback(() => {
    log('[PreviewPlayer] Starting playback');
    isPlayingRef.current = true;
    setIsPlaying(true);

    // Start audio
    if (audioRef.current) {
      const audioStart = audio?.startTime || 0;
      audioRef.current.currentTime = audioStart;
      audioRef.current.play().catch(err => {
        console.warn('[PreviewPlayer] Audio play failed:', err);
      });
    }

    // Start first video
    const firstVideo = videoRefs.current[0];
    if (firstVideo) {
      firstVideo.currentTime = 0;
      firstVideo.play().catch(() => {});
    }

    // Start animation loop
    startTimeRef.current = null;
    animationRef.current = requestAnimationFrame(animate);
  }, [audio, animate]);

  // Stop playback
  const stopPlayback = useCallback(() => {
    log('[PreviewPlayer] Stopping playback');
    isPlayingRef.current = false;
    setIsPlaying(false);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    // Pause all videos
    videoRefs.current.forEach(videoEl => {
      if (videoEl && !videoEl.paused) videoEl.pause();
    });
  }, []);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [startPlayback, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Pause all videos
      videoRefs.current.forEach(videoEl => {
        if (videoEl && !videoEl.paused) videoEl.pause();
      });
    };
  }, []);

  // Auto-play on mount if requested
  useEffect(() => {
    if (autoPlay && clips.length > 0) {
      startPlayback();
    }
  }, [autoPlay, clips.length, startPlayback]);

  // Seek to position
  const handleSeek = useCallback((e) => {
    e.stopPropagation(); // Don't trigger play/pause
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;

    setCurrentTime(newTime);

    // If playing, adjust the start time reference
    if (isPlayingRef.current) {
      startTimeRef.current = performance.now() - (newTime * 1000);
    }

    // Update clip and play/pause videos accordingly
    const clipInfo = getClipAtTime(newTime);
    if (clipInfo) {
      setCurrentClipIndex(clipInfo.index);

      // Seek and play correct video, pause others
      videoRefs.current.forEach((videoEl, idx) => {
        if (!videoEl) return;

        if (idx === clipInfo.index) {
          videoEl.currentTime = clipInfo.localTime;
          if (isPlayingRef.current && videoEl.paused) {
            videoEl.play().catch(() => {});
          }
        } else if (!videoEl.paused) {
          videoEl.pause();
        }
      });
    }

    // Sync audio
    if (audioRef.current) {
      const audioStart = audio?.startTime || 0;
      audioRef.current.currentTime = audioStart + newTime;
    }
  }, [duration, getClipAtTime, audio]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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
      {/* Video elements for all clips */}
      {clips.map((clip, idx) => {
        const clipUrl = getClipUrl(clip);
        return (
          <video
            key={`clip-${idx}-${clip.sourceId || clip.id || idx}`}
            ref={el => videoRefs.current[idx] = el}
            src={clipUrl}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: idx === currentClipIndex ? 1 : 0,
              transition: 'opacity 0.15s ease-out'
            }}
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
          />
        );
      })}

      {/* Audio element */}
      {audio && (
        <audio
          ref={audioRef}
          src={getAudioUrl()}
          preload="auto"
          crossOrigin="anonymous"
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
          background: isPlaying ? 'transparent' : theme.overlay.light,
          zIndex: 5
        }}
      >
        {!isPlaying && (
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: theme.accent.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}>
            ▶
          </div>
        )}
      </div>

      {/* Controls */}
      {showControls && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '8px',
            background: `linear-gradient(transparent, ${theme.overlay.heavy})`,
            zIndex: 6
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Progress bar */}
          <div
            onClick={handleSeek}
            style={{
              height: '4px',
              background: theme.text.muted,
              borderRadius: '2px',
              cursor: 'pointer',
              marginBottom: '6px'
            }}
          >
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: theme.accent.primary,
              borderRadius: '2px'
            }} />
          </div>

          {/* Time display */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '10px',
            color: theme.text.secondary
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
          color: theme.text.muted,
          fontSize: '14px'
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
