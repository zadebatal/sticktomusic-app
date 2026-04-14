/**
 * ApprovalQueue — Swipe-style approve/reject UI for generated content
 *
 * Shows drafts one at a time in a card view. User can:
 * - Approve → marks status as 'approved', moves to next
 * - Reject → marks status as 'rejected' with reason tag, moves to next
 * - Skip → moves to next without changing status
 */

import {
  FeatherArrowLeft,
  FeatherCheck,
  FeatherPlay,
  FeatherSkipForward,
  FeatherX,
} from '@subframe/core';
import React, { useCallback, useMemo, useState } from 'react';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import log from '../../utils/logger';
import { useToast } from '../ui';

const REJECTION_REASONS = [
  { id: 'bad_clips', label: 'Bad clips' },
  { id: 'bad_text', label: 'Bad text' },
  { id: 'bad_timing', label: 'Bad timing' },
  { id: 'bad_audio', label: 'Audio issue' },
  { id: 'too_similar', label: 'Too similar' },
  { id: 'other', label: 'Other' },
];

const ApprovalQueue = ({
  drafts = [], // Array of draft objects with status field
  onApprove, // (draftId) => void
  onReject, // (draftId, reason) => void
  onBack, // () => void — return to content library
  onEdit, // (draft) => void — open in editor
  artistId,
}) => {
  const { toastSuccess } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showRejectReasons, setShowRejectReasons] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Filter to only pending_review items
  const pendingDrafts = useMemo(
    () => drafts.filter((d) => d.status === 'pending_review' || d.status === 'draft'),
    [drafts],
  );

  const currentDraft = pendingDrafts[currentIndex] || null;
  const remaining = pendingDrafts.length - currentIndex;

  const goNext = useCallback(() => {
    setShowRejectReasons(false);
    setPreviewUrl(null);
    if (currentIndex < pendingDrafts.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, pendingDrafts.length]);

  const handleApprove = useCallback(() => {
    if (!currentDraft) return;
    onApprove?.(currentDraft.id);
    toastSuccess('Approved');
    goNext();
  }, [currentDraft, onApprove, toastSuccess, goNext]);

  const handleReject = useCallback(
    (reason) => {
      if (!currentDraft) return;
      onReject?.(currentDraft.id, reason);
      setShowRejectReasons(false);
      goNext();
    },
    [currentDraft, onReject, goNext],
  );

  const handleSkip = useCallback(() => {
    goNext();
  }, [goNext]);

  // Stats
  const approvedCount = drafts.filter((d) => d.status === 'approved').length;
  const rejectedCount = drafts.filter((d) => d.status === 'rejected').length;

  if (pendingDrafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="text-6xl">✅</div>
        <h2 className="text-xl font-semibold text-neutral-800">All caught up!</h2>
        <p className="text-neutral-500 text-center max-w-md">
          {approvedCount > 0 && `${approvedCount} approved`}
          {approvedCount > 0 && rejectedCount > 0 && ' · '}
          {rejectedCount > 0 && `${rejectedCount} rejected`}
          {approvedCount === 0 && rejectedCount === 0 && 'No drafts to review'}
        </p>
        <Button onClick={onBack}>Back to Library</Button>
      </div>
    );
  }

  if (!currentDraft) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <p className="text-neutral-500">No more drafts to review</p>
        <Button onClick={onBack}>Back to Library</Button>
      </div>
    );
  }

  // Get preview URL — fall back to local references so local-only drafts
  // don't render a broken thumbnail.
  const thumbnailUrl =
    currentDraft.thumbnailUrl ||
    currentDraft.cloudUrl ||
    currentDraft.localUrl ||
    currentDraft.montagePhotos?.[0]?.url ||
    currentDraft.montagePhotos?.[0]?.localUrl ||
    null;
  const videoUrl = currentDraft.cloudUrl || currentDraft.localUrl || null;
  const draftName = currentDraft.name || currentDraft.title || `Draft ${currentIndex + 1}`;
  const editorMode = currentDraft.editorMode || 'unknown';
  const clipCount =
    currentDraft.clips?.length ||
    currentDraft.montagePhotos?.length ||
    currentDraft.slides?.length ||
    0;
  const duration = currentDraft.duration ? `${Math.round(currentDraft.duration)}s` : null;
  const qcIssues = currentDraft.qcResult?.issues || [];
  const qcPassed = currentDraft.qcResult?.passed ?? null;

  return (
    <div className="flex flex-col h-full bg-neutral-0">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200">
        <IconButton icon={<FeatherArrowLeft />} onClick={onBack} aria-label="Back" />
        <h2 className="text-lg font-semibold text-neutral-800 flex-1">Review Queue</h2>
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span>
            {currentIndex + 1} / {pendingDrafts.length}
          </span>
          {approvedCount > 0 && <Badge variant="success">{approvedCount} approved</Badge>}
          {rejectedCount > 0 && <Badge variant="error">{rejectedCount} rejected</Badge>}
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        <div className="w-full max-w-lg bg-neutral-50 rounded-xl border border-neutral-200 overflow-hidden shadow-lg">
          {/* Preview */}
          <div className="relative aspect-[9/16] max-h-[50vh] bg-black flex items-center justify-center overflow-hidden">
            {previewUrl && videoUrl ? (
              <video
                src={videoUrl}
                className="w-full h-full object-contain"
                controls
                autoPlay
                muted
              />
            ) : thumbnailUrl ? (
              <>
                <img src={thumbnailUrl} alt={draftName} className="w-full h-full object-contain" />
                {videoUrl && (
                  <button
                    onClick={() => setPreviewUrl(videoUrl)}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
                    aria-label="Play video"
                  >
                    <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center">
                      <FeatherPlay className="w-8 h-8 text-black ml-1" />
                    </div>
                  </button>
                )}
              </>
            ) : (
              <div className="text-neutral-500 text-sm">No preview available</div>
            )}
          </div>

          {/* Info */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-neutral-800">{draftName}</h3>
              <Badge>{editorMode}</Badge>
            </div>

            <div className="flex items-center gap-3 text-sm text-neutral-500">
              {clipCount > 0 && <span>{clipCount} clips</span>}
              {duration && <span>{duration}</span>}
              {currentDraft.createdAt && (
                <span>{new Date(currentDraft.createdAt).toLocaleDateString()}</span>
              )}
            </div>

            {/* QC Status */}
            {qcPassed !== null && (
              <div
                className={`text-sm px-3 py-1.5 rounded ${qcPassed ? 'bg-green-900/20 text-green-400' : 'bg-yellow-900/20 text-yellow-400'}`}
              >
                {qcPassed
                  ? 'QC passed'
                  : `QC: ${qcIssues
                      .map((id) => {
                        const match = REJECTION_REASONS.find((r) => r.id === id);
                        return match ? match.label : id;
                      })
                      .join(', ')}`}
              </div>
            )}

            {/* Text overlays preview */}
            {currentDraft.textOverlays?.length > 0 && (
              <div className="text-sm text-neutral-400 italic truncate">
                &ldquo;{currentDraft.textOverlays[0].text}&rdquo;
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rejection reasons overlay */}
      {showRejectReasons && (
        <div className="px-6 pb-2">
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3">
            <p className="text-sm text-neutral-500 mb-2">Why are you rejecting this?</p>
            <div className="flex flex-wrap gap-2">
              {REJECTION_REASONS.map((reason) => (
                <button
                  key={reason.id}
                  onClick={() => handleReject(reason.id)}
                  className="px-3 py-1.5 text-sm bg-neutral-100 hover:bg-red-900/20 hover:text-red-400 text-neutral-400 rounded-md transition-colors"
                >
                  {reason.label}
                </button>
              ))}
              <button
                onClick={() => setShowRejectReasons(false)}
                className="px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-4 px-6 py-4 border-t border-neutral-200">
        <Button
          variant="destructive"
          size="large"
          onClick={() => setShowRejectReasons(true)}
          disabled={showRejectReasons}
          icon={<FeatherX />}
        >
          Reject
        </Button>

        <Button
          variant="neutral-secondary"
          size="large"
          onClick={handleSkip}
          icon={<FeatherSkipForward />}
        >
          Skip
        </Button>

        {onEdit && (
          <Button variant="neutral-secondary" size="large" onClick={() => onEdit(currentDraft)}>
            Edit
          </Button>
        )}

        <Button
          variant="brand-primary"
          size="large"
          onClick={handleApprove}
          icon={<FeatherCheck />}
        >
          Approve
        </Button>
      </div>

      {/* Remaining count */}
      <div className="text-center text-xs text-neutral-500 pb-3">
        {remaining > 1 ? `${remaining - 1} more to review` : 'Last one!'}
      </div>
    </div>
  );
};

export default ApprovalQueue;
