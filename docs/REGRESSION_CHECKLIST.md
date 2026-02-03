# StickToMusic Regression Checklist

> **Version:** 1.0.0
> **Last Updated:** 2026-02-03
> **Purpose:** Manual regression testing checklist for domain invariants

Run through this checklist after significant changes. Mark each item PASS/FAIL.

---

## Operator Flow Checklist

### Authentication & Access
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| O1 | Login as operator (zadebatal@gmail.com) | Should see operator dashboard | |
| O2 | Attempt operator page as non-operator | Should see "Access Denied" | |
| O3 | Try operator actions via quick search | Should work only for operators | |

### Content Management
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| O4 | Schedule post to Late.co | Should succeed with token | |
| O5 | View all artists' content | Should see all categories | |
| O6 | Approve a video | Status should change to 'approved' | |

---

## Artist Flow Checklist

### Video Creation
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| A1 | Open VideoEditorModal | Modal opens without error | |
| A2 | Upload audio file | Audio loads, waveform shows | |
| A3 | Set trim IN/OUT points | Trim boundaries stored correctly | |
| A4 | Run AI transcription (trimmed audio) | Words should be in LOCAL time (0 = trim start) | |
| A5 | Check word timestamps | First word should start near 0, not trim start | |
| A6 | Run beat detection | Beats should be in LOCAL time | |
| A7 | Verify beats in timeline | Beat markers should align with audio | |
| A8 | Change trim boundaries | Words/beats should be invalidated | |
| A9 | Save to library | Save should succeed | |
| A10 | Reload page and check saved data | Audio URL should be Firebase (not blob:) | |

### Time Window Verification
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| T1 | Trim audio to 10-40s range | trimmedDuration = 30s | |
| T2 | Transcribe trimmed audio | Word times should be 0-30s, not 10-40s | |
| T3 | Check first word time | Should be close to 0, not 10 | |
| T4 | Play from timeline 0s | Audio should play from trim start (10s global) | |
| T5 | Seek to timeline 15s | Audio should be at 25s global | |

---

## Asset Lifecycle Checklist

### Persistence Validation
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| P1 | Create video with clips | Clips stored in category | |
| P2 | Check localStorage | No blob: URLs in stored data | |
| P3 | Check clip thumbnails | Should be null or small | |
| P4 | Check video URLs | Should be Firebase https:// URLs | |
| P5 | Reload browser | Content should persist | |
| P6 | Open previously saved content | Should load from Firebase URLs | |

---

## Failure Mode Checklist

### Late.co API Failures
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| F1 | Disconnect Late.co token | Should show disconnected state | |
| F2 | Attempt post without token | Should show clear error | |
| F3 | Invalid token (401) | Should clear token, show reconnect option | |

### Upload Failures
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| F4 | Upload large file (>100MB) | Should show progress, handle timeout | |
| F5 | Network disconnect during upload | Should show error, allow retry | |
| F6 | Upload unsupported format | Should show validation error | |

### Transcription Failures
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| F7 | Transcribe with invalid API key | Should show auth error | |
| F8 | Transcribe silent audio | Should handle empty results | |
| F9 | Network fail during transcription | Should show error, allow retry | |

### Beat Detection Failures
| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| F10 | Beat detection on speech audio | Should fallback to default BPM | |
| F11 | Analyze corrupted audio file | Should show error, not crash | |

---

## Status Enum Verification

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| S1 | Create new video | Status should be 'draft' | |
| S2 | Export video | Status should transition to 'rendering' | |
| S3 | Complete export | Status should be 'completed' | |
| S4 | Operator approves | Status should be 'approved' | |
| S5 | StatusPill displays | Should show correct color/text | |

---

## Cross-Browser Testing

| Browser | Version | Status | Notes |
|---------|---------|--------|-------|
| Chrome | Latest | | |
| Firefox | Latest | | |
| Safari | Latest | | |
| Edge | Latest | | |

---

## Summary

| Category | Passed | Failed | Total |
|----------|--------|--------|-------|
| Operator Flow | | | 6 |
| Artist Flow | | | 10 |
| Time Window | | | 5 |
| Asset Lifecycle | | | 6 |
| Failure Modes | | | 11 |
| Status Enum | | | 5 |
| **Total** | | | **43** |

---

## Known Limitations

1. **VideoEditorV2.jsx** - Legacy component that doesn't support trim boundaries. Use VideoEditorModal instead.
2. **Operator emails** - Hard-coded list. In production, should use Firestore or environment config.
3. **Local storage limits** - ~5MB max. Large categories may hit quota (thumbnails are stripped).

---

## Regression Test Log

| Date | Tester | Passed | Failed | Notes |
|------|--------|--------|--------|-------|
| | | | | |

