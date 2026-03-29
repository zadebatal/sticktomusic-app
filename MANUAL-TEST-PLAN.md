# Automation Engine — Manual Test Plan

> Run through each test in order. Mark PASS/FAIL. Note any errors in the browser console.
> Login: booneasonmusic@gmail.com / Rayneta4ever (or your conductor account)
> URL: http://localhost:3001

---

## SETUP (do this first)

1. Open browser DevTools (Cmd+Option+I) → Console tab
2. Clear console
3. Navigate to http://localhost:3001
4. Sign in
5. Confirm: no red errors in console on load → [ PASS / FAIL ]

---

## TEST 1: Dump & Generate Modal (#1)

**Where:** Studio → Open any Project → look at the niche tab bar

1. Open a project (or create one if none exist)
2. Look for the lightning bolt "Dump & Generate" button in the niche tabs bar (next to "+ New Niche")
3. Click it → modal should open with a drop zone
4. Drop or select 3-5 video/image files
5. Confirm: files appear in the list with counts (e.g., "3 videos, 2 images")
6. Optionally select an audio file
7. Set variations to 5
8. Click "Generate 5 Variations"
9. Confirm: progress bar shows upload progress
10. Confirm: after upload completes, editor opens automatically

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 2: Cross-Niche Sourcing (#5)

**Where:** Studio → Project with 2+ niches

1. Open a project that has at least 2 niches with media
2. Select a video niche (not slideshow)
3. Look for the "Mix" button next to the "Create" button in the center bar
4. Hover over "Mix" → dropdown should show other niches in the project
5. Check one or more niches → button should change to "+1 niche" (or similar)
6. Click "Create" to open the editor
7. Confirm: media pool in the editor includes clips from the checked niches

**Result:** [ PASS / FAIL ]
**Console errors:** ___

> Note: If the project only has 1 niche, the "Mix" button won't appear. Create a second niche first.

---

## TEST 3: Review Queue / Approval Queue (#13)

**Where:** Studio → Drafts view → "Review" tab

1. Navigate to Drafts (click "View Drafts" from any niche, or use the Drafts view)
2. Look for tabs: Drafts | Review | Scheduled | Posted
3. Click "Review" tab
4. If there are no drafts with status "pending_review", you'll see "All caught up!" → that's correct for now
5. To fully test: you'd need drafts with `status: 'pending_review'` (future generation will set this)

**Verify the tab exists and renders without errors.**

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 4: QC Badges on Draft Cards (#11)

**Where:** Studio → Drafts view → any exported draft card

1. Go to Drafts view
2. Look at any exported video card (one with a rendered video, not a "Recipe")
3. If the draft was exported after this update, it should show a small "QC" badge at the bottom
4. Older drafts won't have QC data — that's expected

**For now, just verify no errors when viewing draft cards.**

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 5: Auto-Schedule Approved (#3)

**Where:** Schedule page → toolbar

1. Navigate to the Schedule page
2. Look at the filter toolbar (All | Scheduled | Posting | Posted | Failed | Sync)
3. Confirm: "Auto-Schedule Approved" button appears (with a + icon, indigo text)
4. Click it
5. If no approved drafts exist: toast should say "No approved drafts to schedule"
6. If approved drafts exist: they should be added to the queue and auto-selected

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 6: AI Caption Generation (#8)

**Where:** Studio → Project → ProjectWorkspace → right panel

1. Open a project workspace
2. Select a niche
3. Scroll down in the right panel → look for "Generate" section (collapsible, indigo text)
4. Click to expand
5. Optionally type context (e.g., "hip hop summer vibes")
6. Click "Generate Captions & Hashtags"
7. **Expected:** Error about API key not configured (unless ANTHROPIC_API_KEY is set in .env.local)
8. If the key IS set: captions and hashtags should appear with accept/reject buttons

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 7: Whisper Transcription → Text Banks (#2)

**Where:** Studio → Project → Slideshow Niche with audio selected

1. Open a slideshow niche that has audio assigned
2. Look for a "Transcribe" or microphone button near the audio section
3. Click it
4. **Expected:** Either transcription runs (if OpenAI key configured) or error about API key
5. If it runs: lyrics distributor should open, letting you assign lines to slide banks

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 8: Clip Recycling — Usage Tracking (#9)

**Where:** Studio → Project → any video niche → generate content

1. Open a Multi-Clip or Photo Montage niche
2. Add some clips/photos to the timeline
3. Click "Generate" to create variations
4. After generation completes, go back to the media pool
5. The clips that were used should now have incremented `useCount` (not visible in UI yet, but check console: no errors during generation)

**Verify generation works without errors.**

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 9: Remix Variations (#10)

**Where:** Studio → Drafts view

1. Go to the Drafts view
2. The remix feature is wired but doesn't have a visible button yet on draft cards — it's available through the `onRemixDraft` prop
3. **For now, just verify no errors in the Drafts view**

**Result:** [ PASS / FAIL ]
**Console errors:** ___

> Note: Remix button on cards is a future UI addition. The handler exists in VideoStudio.

---

## TEST 10: Photo Montage Export with QC (#11 wired)

**Where:** Studio → Project → Photo Montage niche

1. Open a Photo Montage niche
2. Add photos + audio
3. Export a montage
4. Confirm: export completes successfully
5. Check console: should see `[QC] ...` log message (quick QC runs after render)
6. The saved draft should have `qcResult` and `sourceClipIds` fields

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 11: Navigation Smoke Test

Run through these screens and confirm no crashes:

1. [ ] Studio home page loads
2. [ ] Project Landing (list of projects) loads
3. [ ] Open a project → ProjectWorkspace loads
4. [ ] Switch between niche tabs
5. [ ] Click "All Media" tab
6. [ ] Click "Captions & Hashtags" section
7. [ ] Go to Drafts → all tabs render (Drafts, Review, Scheduled, Posted)
8. [ ] Go to Schedule page
9. [ ] Go to Analytics page
10. [ ] Go to Settings page

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## TEST 12: Existing Functionality Regression

Make sure nothing broke:

1. [ ] Create a new project
2. [ ] Create a new niche inside it (slideshow or video)
3. [ ] Upload a file to the niche
4. [ ] Open an editor (any type)
5. [ ] Save a draft
6. [ ] View draft in Drafts list
7. [ ] Schedule a post (add to queue)
8. [ ] Delete a draft
9. [ ] Delete a niche
10. [ ] Delete a project

**Result:** [ PASS / FAIL ]
**Console errors:** ___

---

## SUMMARY

| Test | Feature | Result |
|------|---------|--------|
| 1 | Dump & Generate | |
| 2 | Cross-Niche Sourcing | |
| 3 | Review Queue | |
| 4 | QC Badges | |
| 5 | Auto-Schedule Approved | |
| 6 | AI Captions | |
| 7 | Whisper → Text Banks | |
| 8 | Clip Recycling | |
| 9 | Remix Variations | |
| 10 | Photo Montage + QC | |
| 11 | Navigation Smoke | |
| 12 | Regression | |

**Total PASS:** __ / 12
**Blocking issues:** ___

---

## Features Not Testable Locally (need API keys or cloud auth)

- **Vision Categorization (#6)**: Needs ANTHROPIC_API_KEY in Vercel
- **Song Recognition (#4)**: Needs AudD API key (existing, may work)
- **Watch Folder (#12)**: Needs Google Drive/Dropbox OAuth configured
- **Smart Duration (#7)**: Service-only, wired but not surfaced in UI yet
- **Momentum Auto-Edit (#14)**: Service-only, ready for generation wiring
