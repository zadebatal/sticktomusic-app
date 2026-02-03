# Manual Test Script - StickToMusic Features

## Pre-requisites
- App running locally (`npm start`) or deployed
- At least one category with videos and audio uploaded

---

## 1. DELETE FUNCTIONALITY

### Test 1.1: Delete Video Clip
1. Open Video Editor → Select a category
2. Hover over a video clip in the Videos section
3. **Expected:** Red ✕ button appears in top-right corner
4. Click the ✕ button
5. **Expected:** Confirmation dialog appears with message "This will permanently delete..."
6. Click "Delete"
7. **Expected:** Video removed from list
8. Refresh page
9. **Expected:** Video stays deleted (persisted)

### Test 1.2: Delete Audio Track
1. In same category, hover over an audio track
2. **Expected:** Red ✕ button appears on the right
3. Click ✕ button
4. **Expected:** Confirmation dialog appears
5. Click "Cancel"
6. **Expected:** Dialog closes, audio NOT deleted
7. Click ✕ again, then "Delete"
8. **Expected:** Audio removed from list

### Test 1.3: Cancel Delete
1. Hover over any video/audio, click ✕
2. Click outside the dialog OR click "Cancel"
3. **Expected:** Item NOT deleted

---

## 2. RENAME FUNCTIONALITY

### Test 2.1: Rename Video (Click Method)
1. Hover over a video clip
2. Click on the video name label (shown at bottom of thumbnail)
3. **Expected:** Name becomes editable input field with purple border
4. Type a new name
5. Press Enter
6. **Expected:** Name saved, input closes
7. Refresh page
8. **Expected:** New name persisted

### Test 2.2: Rename Video (Button Method)
1. Hover over a video clip
2. **Expected:** Pencil (✎) button appears next to ✕
3. Click the pencil button
4. **Expected:** Name becomes editable
5. Type new name, click outside (blur)
6. **Expected:** Name saved

### Test 2.3: Rename Audio
1. Hover over an audio track
2. Click on the audio name OR the pencil button
3. **Expected:** Name becomes editable input
4. Type new name, press Enter
5. **Expected:** Name updated

### Test 2.4: Cancel Rename
1. Click on video/audio name to edit
2. Press Escape
3. **Expected:** Edit cancelled, original name restored

### Test 2.5: Empty Name Handling
1. Click on video name to edit
2. Delete all text, press Enter
3. **Expected:** Original name kept (empty names rejected)

---

## 3. KEYBOARD SHORTCUTS (Video Editor Modal)

### Test 3.1: Open Video Editor
1. Select a category → Click "Create using this category"
2. Click "Make a video"
3. Select an audio track
4. **Expected:** Video editor modal opens

### Test 3.2: Play/Pause (Space)
1. In video editor, press Space bar
2. **Expected:** Audio/video starts playing
3. Press Space again
4. **Expected:** Playback pauses

### Test 3.3: Scrub Left/Right (Arrow Keys)
1. Press Right Arrow
2. **Expected:** Playhead moves forward ~1 second
3. Press Left Arrow
4. **Expected:** Playhead moves backward ~1 second
5. Hold Shift and press arrows
6. **Expected:** Still works (no conflict)

### Test 3.4: Mute/Unmute (M)
1. Press M key
2. **Expected:** Audio mutes, speaker icon shows muted state
3. Press M again
4. **Expected:** Audio unmutes

### Test 3.5: Save (Cmd+S / Ctrl+S)
1. Make some changes (add clips, edit text)
2. Press Cmd+S (Mac) or Ctrl+S (Windows)
3. **Expected:** Video saved, modal closes
4. Re-open the video
5. **Expected:** Changes persisted

### Test 3.6: Close (Escape)
1. Open video editor
2. Press Escape
3. **Expected:** Modal closes

### Test 3.7: Shortcuts Don't Fire in Input Fields
1. Click in the lyrics text area
2. Press Space
3. **Expected:** Space types into field (doesn't play/pause)
4. Press M
5. **Expected:** Types 'm' (doesn't mute)

---

## 4. AUTO-SAVE & RECOVERY

### Test 4.1: Auto-Save Indicator
1. Open video editor, select audio, add some clips
2. Wait 30 seconds
3. **Expected:** Footer shows "✓ Auto-saved [time]" in green

### Test 4.2: Recovery Prompt
1. Open video editor
2. Select audio, add clips, type some lyrics
3. Wait 30+ seconds for auto-save
4. Close modal WITHOUT clicking "Confirm"
5. Refresh the entire page
6. Re-open video editor (same category)
7. **Expected:** "Recover Unsaved Work?" prompt appears
8. **Expected:** Shows audio name, clip count, word count

### Test 4.3: Restore Draft
1. On recovery prompt, click "✨ Restore Draft"
2. **Expected:** Previous audio, clips, lyrics restored
3. **Expected:** Prompt closes

### Test 4.4: Discard Draft
1. Trigger recovery prompt again (repeat 4.2)
2. Click "Start Fresh"
3. **Expected:** Editor opens empty, draft discarded
4. Close and re-open editor
5. **Expected:** No recovery prompt (draft was cleared)

### Test 4.5: Manual Save Clears Auto-Save
1. Make changes, wait for auto-save
2. Click "Confirm" to save
3. Close and re-open editor
4. **Expected:** No recovery prompt (auto-save cleared)

### Test 4.6: Old Drafts Expire
1. (Advanced) Manually edit localStorage:
   - Find key `stm_autosave_[category_id]`
   - Change `savedAt` to >24 hours ago
2. Refresh and open editor
3. **Expected:** No recovery prompt (expired draft cleared)

---

## 5. SHORTCUT HINT

### Test 5.1: Shortcut Hint Visible
1. Open video editor
2. Look at footer (bottom right)
3. **Expected:** "⌘S to save" hint visible in gray box

---

## Test Results

| Feature | Test | Pass/Fail | Notes |
|---------|------|-----------|-------|
| Delete | 1.1 Video | | |
| Delete | 1.2 Audio | | |
| Delete | 1.3 Cancel | | |
| Rename | 2.1 Video Click | | |
| Rename | 2.2 Video Button | | |
| Rename | 2.3 Audio | | |
| Rename | 2.4 Escape Cancel | | |
| Rename | 2.5 Empty Name | | |
| Shortcuts | 3.2 Space | | |
| Shortcuts | 3.3 Arrows | | |
| Shortcuts | 3.4 Mute | | |
| Shortcuts | 3.5 Save | | |
| Shortcuts | 3.6 Escape | | |
| Shortcuts | 3.7 Input Fields | | |
| Auto-save | 4.1 Indicator | | |
| Auto-save | 4.2 Recovery Prompt | | |
| Auto-save | 4.3 Restore | | |
| Auto-save | 4.4 Discard | | |
| Auto-save | 4.5 Manual Save | | |

---

## Known Edge Cases
- Very long file names may truncate in the UI
- Auto-save only triggers if there's content to save
- Keyboard shortcuts only work when not focused on input fields
