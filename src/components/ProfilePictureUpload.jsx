import React, { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import { getAuth, updateProfile } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import getCroppedImg from '../utils/cropImage';
import { uploadFile } from '../services/firebaseStorage';
import { Button } from '../ui/components/Button';
import { FeatherX } from '@subframe/core';
import log from '../utils/logger';

/**
 * ProfilePictureUpload — modal with file picker, circular crop, zoom, and save.
 * On save: uploads cropped image → updates Firebase Auth photoURL → updates allowedUsers doc → callback.
 */
const ProfilePictureUpload = ({ db, onSave, onClose }) => {
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result);
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels || !imageSrc) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const file = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
      const { url } = await uploadFile(file, 'profile-pictures');

      const auth = getAuth();
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { photoURL: url });
      }

      if (db && auth.currentUser?.email) {
        const userRef = doc(db, 'allowedUsers', auth.currentUser.email.toLowerCase());
        await updateDoc(userRef, { photoURL: url }).catch(() => {});
      }

      onSave?.(url);
      onClose?.();
    } catch (err) {
      log.error('[ProfilePicture] Upload failed:', err);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#111118] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Update Profile Picture</span>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <FeatherX style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {!imageSrc ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-dashed border-neutral-600 text-neutral-500 text-sm">
              No image
            </div>
            <Button variant="brand-primary" onClick={() => fileRef.current?.click()}>
              Choose Photo
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        ) : (
          <>
            <div className="relative w-full" style={{ height: 300 }}>
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div className="flex items-center gap-3 mt-4">
              <span className="text-caption font-caption text-neutral-400 flex-none">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-indigo-500"
              />
            </div>
            <div className="flex items-center gap-3 mt-4">
              <Button variant="neutral-secondary" className="flex-1" onClick={() => { setImageSrc(null); setCrop({ x: 0, y: 0 }); setZoom(1); }}>
                Change Photo
              </Button>
              <Button variant="brand-primary" className="flex-1" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProfilePictureUpload;
