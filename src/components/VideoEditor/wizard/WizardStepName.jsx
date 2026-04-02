/**
 * WizardStepName — Step 1: Project name
 */
import React from 'react';
import { TextField } from '../../../ui/components/TextField';
import { Button } from '../../../ui/components/Button';

const WizardStepName = ({ projectName, setProjectName, onNext, isMobile }) => {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md mx-auto">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Name your project</span>
        <span className="text-body font-body text-neutral-400">
          Give your project a name to get started
        </span>
      </div>

      <div className="flex flex-col gap-4 w-full">
        <TextField className="h-auto w-full" variant="filled" label="Project Name">
          <TextField.Input
            placeholder="e.g., Summer Campaign 2026"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && projectName.trim()) onNext();
            }}
            autoFocus={!isMobile}
          />
        </TextField>
      </div>

      <Button
        variant="brand-primary"
        size="medium"
        className="w-full"
        disabled={!projectName.trim()}
        onClick={onNext}
      >
        Next
      </Button>
    </div>
  );
};

export default WizardStepName;
