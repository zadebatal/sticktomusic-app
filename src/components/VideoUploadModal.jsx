import React, { useState } from 'react';
import { uploadFile } from '../services/firebaseStorage';

export default function VideoUploadModal({ isOpen, onClose, currentArtistId, showToast }) {
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedVideos, setUploadedVideos] = useState([]);

  if (!isOpen) return null;

  const handleUpload = async (file) => {
    if (!file || !file.type.startsWith('video/')) {
      showToast('Please upload a video file', 'error');
      return;
    }
    setUploadingVideo(true);
    setUploadProgress(0);
    try {
      const result = await uploadFile(file, `videos/${currentArtistId}`, (progress) => {
        setUploadProgress(progress);
      });
      setUploadedVideos((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          name: file.name,
          url: result.url,
          path: result.path,
          uploadedAt: new Date().toISOString(),
          artistId: currentArtistId,
        },
      ]);
      showToast('Video uploaded!', 'success');
    } catch (error) {
      showToast(`Upload failed: ${error.message}`, 'error');
    } finally {
      setUploadingVideo(false);
      setUploadProgress(0);
    }
  };

  const filteredVideos = uploadedVideos.filter((v) => v.artistId === currentArtistId);

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl font-bold">Upload Videos</h2>
            <p className="text-xs sm:text-sm text-zinc-500 mt-1">
              Upload videos to use for scheduling
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl">
            {'\u2715'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Upload Zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition ${uploadingVideo ? 'border-purple-500 bg-purple-500/10' : 'border-zinc-700 hover:border-zinc-600'}`}
            onDrop={async (e) => {
              e.preventDefault();
              await handleUpload(e.dataTransfer.files[0]);
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            {uploadingVideo ? (
              <div>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-purple-500 border-t-transparent animate-spin" />
                <p className="text-purple-400 font-medium">
                  Uploading... {Math.round(uploadProgress)}%
                </p>
                <div className="w-48 h-2 bg-zinc-800 rounded-full mx-auto mt-2 overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="text-4xl mb-4">{'\uD83D\uDCF9'}</div>
                <p className="text-zinc-300 font-medium mb-2">Drag & drop video here</p>
                <p className="text-zinc-500 text-sm mb-4">or click to browse</p>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  id="video-upload-input"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    await handleUpload(file);
                    e.target.value = '';
                  }}
                />
                <label
                  htmlFor="video-upload-input"
                  className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg cursor-pointer transition"
                >
                  Browse Files
                </label>
                <p className="text-xs text-zinc-600 mt-4">MP4, MOV, WebM up to 500MB</p>
              </>
            )}
          </div>

          {/* Uploaded Videos List */}
          {filteredVideos.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-zinc-400 mb-3">
                Uploaded Videos ({filteredVideos.length})
              </h3>
              <div className="space-y-2">
                {filteredVideos.map((video) => (
                  <div
                    key={video.id}
                    className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl">{'\uD83C\uDFAC'}</span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{video.name}</p>
                        <p className="text-xs text-zinc-500">
                          {new Date(video.uploadedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(video.url);
                          showToast('URL copied to clipboard!', 'success');
                        }}
                        className="px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-500/20 rounded-lg transition"
                      >
                        Copy URL
                      </button>
                      <button
                        onClick={() => {
                          setUploadedVideos((prev) => prev.filter((v) => v.id !== video.id));
                        }}
                        className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Tip */}
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Quick Tip</h3>
            <p className="text-sm text-zinc-500">
              After uploading, copy the video URL and paste it into the batch scheduler. Each video
              can be scheduled to multiple accounts at once.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
