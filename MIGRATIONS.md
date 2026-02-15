# Data Migration Guide

This document outlines the process for safely migrating data structures in StickToMusic to prevent data loss.

## The Problem

Changing Firestore paths or data structures without a migration strategy causes:
- ❌ Lost user data (drafts, slideshows, videos)
- ❌ Subscriptions overwriting localStorage with empty Firestore data
- ❌ Broken features when new code expects new structure

## The Solution: Two-Phase Migration

### Phase 1: Compatibility Layer (Deploy First)

Write code that works with **BOTH** old and new data structures.

```javascript
// ❌ WRONG - Breaks immediately
export const loadData = async (db, artistId) => {
  // Only reads new path - old data is lost
  const docRef = doc(db, 'artists', artistId, 'library', 'data', 'items');
  return await getDoc(docRef);
};

// ✅ RIGHT - Reads both paths
export const loadData = async (db, artistId) => {
  // Check old path first
  const oldDocRef = doc(db, 'artists', artistId, 'studio', 'items');
  const oldDoc = await getDoc(oldDocRef);

  if (oldDoc.exists()) {
    // Migrate from old to new
    const data = oldDoc.data();
    await saveToNewPath(db, artistId, data);
    await deleteDoc(oldDocRef); // Clean up
    return data;
  }

  // Check new path
  const newDocRef = doc(db, 'artists', artistId, 'library', 'data', 'items');
  const newDoc = await getDoc(newDocRef);

  if (newDoc.exists()) {
    return newDoc.data();
  }

  // Fallback to localStorage
  return getLocalData(artistId);
};
```

**Commit message format:**
```
[MIGRATION] Add dual-path support for items collection

Phase 1 of migration from studio/items to library/data/items.
Reads old path first, migrates to new, then reads new path.
Preserves all existing data. Phase 2 (cleanup) will deploy in 48 hours.
```

### Phase 2: Cleanup (Deploy 48 Hours Later)

After Phase 1 has been live for 48 hours and all users have migrated:

```javascript
// Remove old path code
export const loadData = async (db, artistId) => {
  const docRef = doc(db, 'artists', artistId, 'library', 'data', 'items');
  const doc = await getDoc(docRef);
  return doc.exists() ? doc.data() : getLocalData(artistId);
};
```

**Commit message format:**
```
[MIGRATION] Remove old studio/items path (Phase 2 cleanup)

Phase 1 deployed 48 hours ago. All users have migrated.
Safe to remove old path support.
```

## Real-World Example: createdContent Migration

### What Went Wrong (Session 50)

1. ❌ Changed `saveCreatedContentAsync` to use new path
2. ❌ Changed `loadCreatedContentAsync` to use new path
3. ❌ Changed `subscribeToCreatedContent` to use new path
4. ❌ Deployed all at once
5. ❌ Subscription loaded empty Firestore, overwrote localStorage
6. ❌ **Result: All recent drafts lost**

### What Should Have Happened

**Friday, Week 1 - Phase 1 Deploy:**
```javascript
export const loadCreatedContentAsync = async (db, artistId) => {
  // Check old path first
  const oldDocRef = doc(db, 'artists', artistId, 'studio', 'createdContent');
  const oldDoc = await getDoc(oldDocRef);

  if (oldDoc.exists()) {
    // Migrate
    const data = oldDoc.data();
    await saveCreatedContentAsync(db, artistId, data); // Uses new path
    await deleteDoc(oldDocRef);
    return data;
  }

  // Check new path...
  // Fallback to localStorage...
};
```

**Monday, Week 2 - Verify:**
- Check logs: "✓ Migrated X users"
- Check Firestore: Old documents deleted, new structure populated
- No user complaints

**Friday, Week 2 - Phase 2 Deploy:**
- Remove old path code
- Clean, simple implementation

## Migration Checklist

Before changing ANY data structure:

### Planning Phase
- [ ] Document current structure (Firestore paths, localStorage keys)
- [ ] Document new structure
- [ ] Identify all read locations (grep for function names)
- [ ] Identify all write locations
- [ ] Write migration plan (Phase 1 + Phase 2)

### Phase 1 Implementation
- [ ] Write dual-path read logic (old → migrate → new → localStorage)
- [ ] Test with empty data (new user)
- [ ] Test with old data (simulated existing user)
- [ ] Test with new data (already migrated user)
- [ ] Add migration logging (count how many migrate)
- [ ] Commit with `[MIGRATION]` prefix
- [ ] Deploy on Friday afternoon

### Phase 1 Monitoring (48 hours)
- [ ] Check logs for migration counts
- [ ] Monitor error rates
- [ ] Check user support channels
- [ ] Verify Firestore shows new structure populating
- [ ] Verify old documents being deleted

### Phase 2 Implementation
- [ ] Remove old path code
- [ ] Remove migration logging (keep error handling)
- [ ] Test on production (should work identically)
- [ ] Commit with `[MIGRATION]` prefix + "Phase 2 cleanup"
- [ ] Deploy

## Common Pitfalls

### 1. Subscription Overwrites
**Problem:** Firestore subscriptions run before migration, overwrite localStorage.

**Solution:**
```javascript
export const subscribeToData = (db, artistId, callback) => {
  // Run migration FIRST, then subscribe
  loadDataAsync(db, artistId).then(() => {
    const collectionRef = collection(db, 'artists', artistId, 'library', 'data');
    return onSnapshot(collectionRef, (snapshot) => {
      const data = snapshot.docs.map(d => d.data());

      // Only overwrite localStorage if we have data OR if localStorage is also empty
      const localData = getLocalData(artistId);
      if (data.length > 0 || localData.length === 0) {
        saveLocalData(artistId, data);
      }

      callback(data);
    });
  });
};
```

### 2. Non-Serializable Fields
**Problem:** Firestore rejects objects with `File`, `Blob`, or functions.

**Solution:**
```javascript
// Always clean before Firestore save
const cleanForFirestore = (obj) => {
  const { file, localUrl, ...clean } = obj;
  return clean;
};

await setDoc(docRef, cleanForFirestore(data));
```

### 3. Blob URL Expiration
**Problem:** Saving `blob:` URLs that expire on page refresh.

**Solution:**
```javascript
// Upload blobs to Firebase Storage first
if (data.url?.startsWith('blob:') && data.file) {
  const { url: permanentUrl } = await uploadFile(data.file, 'folder');
  data.url = permanentUrl;
  delete data.file;
}
```

## Rollback Plan

If migration goes wrong:

1. **Immediate:** Revert to previous commit
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **If data lost:** Restore from Firestore point-in-time recovery
   - Firebase Console → Firestore → Backups
   - Restore to timestamp before migration

3. **If localStorage wiped:** No recovery possible
   - This is why we ALWAYS check localStorage before overwriting
   - This is why we test migrations thoroughly

## Test Artist Account

Create a dedicated test artist:
- Never use for production content
- Populate with sample data matching production
- Run migrations on test artist FIRST
- Verify migration succeeds before deploying to production

## Friday Deployment Rule

Deploy risky changes (migrations, auth, payments) on **Friday afternoon**:
- ✅ You have the weekend to monitor
- ✅ Lower traffic for issues to surface
- ✅ Time to rollback before Monday
- ❌ Don't deploy on Thursday (too close to weekend)
- ❌ Don't deploy on Monday (whole week to break things)

## Summary

### Do This:
1. Write migration that supports BOTH old and new
2. Deploy Phase 1 with `[MIGRATION]` tag
3. Wait 48 hours, monitor
4. Deploy Phase 2 cleanup
5. Deploy on Friday

### Don't Do This:
1. Change paths without migration
2. Deploy breaking changes all at once
3. Overwrite localStorage without checking
4. Save blob URLs to Firestore
5. Skip testing with existing data

---

**Remember:** Data loss is permanent. Take the extra 30 minutes to write a migration. Your users will thank you. 🙏
