/**
 * WizardStepName — Step 1: Project name + optional linked page
 */
import React from 'react';
import { TextField } from '../../../ui/components/TextField';
import { Button } from '../../../ui/components/Button';
import { DropdownMenu } from '../../../ui/components/DropdownMenu';
import { FeatherChevronDown } from '@subframe/core';
import * as SubframeCore from '@subframe/core';

const WizardStepName = ({
  projectName,
  setProjectName,
  linkedPage,
  setLinkedPage,
  uniquePages,
  onNext,
  isMobile,
}) => {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md mx-auto">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-heading-2 font-heading-2 text-[#ffffffff]">Name your project</span>
        <span className="text-body font-body text-neutral-400">
          Give it a name and optionally link a social page
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

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-white">Linked Page (Optional)</span>
          <SubframeCore.DropdownMenu.Root>
            <SubframeCore.DropdownMenu.Trigger asChild>
              <Button
                className="h-10 w-full"
                variant="neutral-secondary"
                iconRight={<FeatherChevronDown />}
              >
                {linkedPage ? `@${linkedPage.handle} · ${linkedPage.platform}` : 'No page linked'}
              </Button>
            </SubframeCore.DropdownMenu.Trigger>
            <SubframeCore.DropdownMenu.Content side="bottom" align="start" sideOffset={4} asChild>
              <DropdownMenu>
                <DropdownMenu.DropdownItem onClick={() => setLinkedPage(null)}>
                  No page linked
                </DropdownMenu.DropdownItem>
                {uniquePages.map((p) => (
                  <DropdownMenu.DropdownItem
                    key={`${p.handle}_${p.platform}`}
                    onClick={() =>
                      setLinkedPage({
                        handle: p.handle,
                        platform: p.platform,
                        accountId: p.lateAccountId,
                      })
                    }
                  >
                    @{p.handle} · {p.platform}
                  </DropdownMenu.DropdownItem>
                ))}
              </DropdownMenu>
            </SubframeCore.DropdownMenu.Content>
          </SubframeCore.DropdownMenu.Root>
        </div>
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
