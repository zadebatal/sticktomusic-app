/**
 * ProjectWizard — Full-page guided wizard for creating a project with niches and populated banks.
 * Eager data creation: project created after Step 1, niches after Step 2, banks populated in Step 3.
 * Cancel cleans up created project + niches.
 */

import { FeatherArrowLeft, FeatherX } from '@subframe/core';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import {
  clearPendingDeletion,
  createNiche,
  createProject,
  deleteCollectionAsync,
  getProjectNiches,
  getUserCollections,
  markCollectionPendingDeletion,
  PIPELINE_COLORS,
  saveCollections,
  saveCollectionToFirestore,
} from '../../services/libraryService';
import { createNicheFolder, createProjectFolder } from '../../services/localProjectService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Stepper } from '../../ui/components/Stepper';
import { useToast } from '../ui';
import WizardStepBanks from './wizard/WizardStepBanks';
import WizardStepName from './wizard/WizardStepName';
import WizardStepNiches from './wizard/WizardStepNiches';

const STEPS = [
  { label: 'Name', stepNumber: '1' },
  { label: 'Niches', stepNumber: '2' },
  { label: 'Banks', stepNumber: '3' },
];

const ProjectWizard = ({
  db,
  artistId,
  artistName = 'Unknown',
  latePages = [],
  manualAccounts = [],
  onComplete,
  onCancel,
}) => {
  const { success: toastSuccess, error: toastError } = useToast();
  const { isMobile } = useIsMobile();

  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState('');
  const [selectedFormats, setSelectedFormats] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [createdNicheMap, setCreatedNicheMap] = useState({}); // { formatId: nicheId }
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Track whether we've created data (for cancel cleanup)
  const hasCreatedDataRef = useRef(false);

  // Step 1 → 2: Create project
  const handleStep1Next = useCallback(async () => {
    if (!projectName.trim()) return;
    try {
      localStorage.removeItem(`stm_projects_deleted_${artistId}`);
      const project = createProject(
        artistId,
        {
          name: projectName.trim(),
          color: PIPELINE_COLORS[Math.floor(Math.random() * PIPELINE_COLORS.length)],
        },
        db,
      );
      setProjectId(project.id);
      hasCreatedDataRef.current = true;
      // Create project folder on disk (Electron only, non-blocking)
      createProjectFolder(artistName, projectName.trim()).catch(() => {});
      setStep(2);
    } catch (err) {
      toastError('Failed to create project');
    }
  }, [artistId, db, projectName, toastError, artistName]);

  // Step 2 → 3: Create niches for selected formats
  const handleStep2Next = useCallback(async () => {
    if (selectedFormats.length === 0) return;
    try {
      const newMap = { ...createdNicheMap };

      // Create niches that don't exist yet
      for (const fmt of selectedFormats) {
        if (!newMap[fmt.id]) {
          const niche = createNiche(artistId, { projectId, format: fmt }, db);
          newMap[fmt.id] = niche.id;
          // Create niche folder on disk (Electron only, non-blocking)
          createNicheFolder(artistName, projectName, fmt.name).catch(() => {});
        }
      }

      // Delete niches for deselected formats (user went back and unchecked)
      for (const [fmtId, nicheId] of Object.entries(createdNicheMap)) {
        if (!selectedFormats.find((f) => f.id === fmtId)) {
          markCollectionPendingDeletion(nicheId);
          await deleteCollectionAsync(db, artistId, nicheId);
          clearPendingDeletion(nicheId);
          delete newMap[fmtId];
        }
      }

      setCreatedNicheMap(newMap);
      setStep(3);
    } catch (err) {
      toastError('Failed to create niches');
    }
  }, [
    artistId,
    db,
    projectId,
    selectedFormats,
    createdNicheMap,
    toastError,
    artistName,
    projectName,
  ]);

  // Step 2 back → Step 1: can't un-create the project, but we allow name editing
  const handleStep2Back = useCallback(() => {
    setStep(1);
  }, []);

  // Step 3 back → Step 2
  const handleStep3Back = useCallback(() => {
    setStep(2);
  }, []);

  // Final "Create" — data already persisted, just navigate
  const handleComplete = useCallback(() => {
    toastSuccess(`Project "${projectName}" created`);
    onComplete(projectId);
  }, [projectId, projectName, toastSuccess, onComplete]);

  // Cancel — cleanup created data
  const handleCancel = useCallback(async () => {
    if (!hasCreatedDataRef.current || !projectId) {
      onCancel();
      return;
    }

    setIsCancelling(true);
    try {
      // Delete niches first
      for (const nicheId of Object.values(createdNicheMap)) {
        markCollectionPendingDeletion(nicheId);
        await deleteCollectionAsync(db, artistId, nicheId);
        clearPendingDeletion(nicheId);
      }
      // Delete project
      markCollectionPendingDeletion(projectId);
      await deleteCollectionAsync(db, artistId, projectId);
      clearPendingDeletion(projectId);
    } catch (err) {
      // Best effort cleanup
    }
    setIsCancelling(false);
    onCancel();
  }, [projectId, createdNicheMap, db, artistId, onCancel]);

  const handleCancelClick = useCallback(() => {
    if (hasCreatedDataRef.current) {
      setShowCancelConfirm(true);
    } else {
      onCancel();
    }
  }, [onCancel]);

  // Step 1 name change: update project in storage if already created
  const handleProjectNameChange = useCallback(
    async (name) => {
      setProjectName(name);
      if (projectId && name.trim()) {
        const cols = getUserCollections(artistId);
        const idx = cols.findIndex((c) => c.id === projectId);
        if (idx !== -1) {
          cols[idx].name = name.trim();
          cols[idx].updatedAt = new Date().toISOString();
          saveCollections(artistId, cols);
          if (db) {
            try {
              await saveCollectionToFirestore(db, artistId, cols[idx]);
            } catch (e) {
              /* ok */
            }
          }
        }
      }
    },
    [projectId, artistId, db],
  );

  // Get niche IDs as array for Step 3
  const nicheIds = useMemo(() => Object.values(createdNicheMap), [createdNicheMap]);

  return (
    <div className="flex w-full h-full flex-col items-center bg-black overflow-y-auto">
      {/* Top bar */}
      <div className="flex w-full flex-none items-center justify-between border-b border-solid border-neutral-200 px-4 sm:px-6 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <IconButton
            variant="neutral-tertiary"
            size="medium"
            icon={step === 1 ? <FeatherX /> : <FeatherArrowLeft />}
            aria-label={step === 1 ? 'Cancel' : 'Back'}
            onClick={
              step === 1 ? handleCancelClick : step === 2 ? handleStep2Back : handleStep3Back
            }
          />
          <span className="text-heading-3 font-heading-3 text-[#ffffffff] truncate">
            {projectId ? `New Project: ${projectName}` : 'New Project'}
          </span>
        </div>
        <Button
          variant="neutral-tertiary"
          size="small"
          onClick={handleCancelClick}
          disabled={isCancelling}
        >
          Cancel
        </Button>
      </div>

      {/* Stepper */}
      <div className="w-full max-w-lg px-4 sm:px-6 py-6">
        <Stepper>
          {STEPS.map((s, i) => (
            <Stepper.Step
              key={s.label}
              variant={step > i + 1 ? 'completed' : step === i + 1 ? 'active' : 'default'}
              firstStep={i === 0}
              lastStep={i === STEPS.length - 1}
              stepNumber={s.stepNumber}
              label={s.label}
            />
          ))}
        </Stepper>
      </div>

      {/* Step content */}
      <div className="flex flex-col items-center w-full flex-1 px-4 sm:px-6 pb-8 overflow-y-auto">
        {step === 1 && (
          <WizardStepName
            projectName={projectName}
            setProjectName={projectId ? handleProjectNameChange : setProjectName}
            onNext={projectId ? () => setStep(2) : handleStep1Next}
            isMobile={isMobile}
          />
        )}

        {step === 2 && (
          <WizardStepNiches
            selectedFormats={selectedFormats}
            setSelectedFormats={setSelectedFormats}
            onNext={handleStep2Next}
            onBack={handleStep2Back}
          />
        )}

        {step === 3 && projectId && (
          <WizardStepBanks
            db={db}
            artistId={artistId}
            projectId={projectId}
            nicheMap={createdNicheMap}
            selectedFormats={selectedFormats}
            onComplete={handleComplete}
            onBack={handleStep3Back}
          />
        )}
      </div>

      {/* Cancel confirmation dialog */}
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80"
          onClick={() => setShowCancelConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-neutral-200 bg-[#111111] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-heading-3 font-heading-3 text-[#ffffffff] block mb-2">
              Cancel project creation?
            </span>
            <span className="text-body font-body text-neutral-400 block mb-6">
              The project and its niches will be deleted. Any uploaded media will remain in your
              library.
            </span>
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="neutral-secondary"
                size="medium"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep editing
              </Button>
              <Button
                variant="destructive-primary"
                size="medium"
                onClick={handleCancel}
                loading={isCancelling}
              >
                Delete & cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectWizard;
