import React, { useState } from 'react';
import {
  getCategoryNames,
  generateFromTemplate,
  saveCategory,
  deleteCategory,
  resetToDefaults,
} from '../services/contentTemplateService';
import log from '../utils/logger';

export default function ContentTemplatesModal({
  isOpen,
  onClose,
  artistName,
  contentBanks,
  currentArtistId,
  db,
  showToast,
}) {
  const [editingCategory, setEditingCategory] = useState(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    hashtagsAlways: '',
    hashtagsPool: '',
    captionsAlways: '',
    captionsPool: '',
  });
  const [savingTemplate, setSavingTemplate] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    onClose();
    setEditingCategory(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl font-bold">Content Templates</h2>
            <p className="text-xs sm:text-sm text-zinc-500 mt-1">
              Reusable caption & hashtag combos for {artistName || 'this artist'}
            </p>
          </div>
          <button onClick={handleClose} className="text-zinc-500 hover:text-white text-2xl">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {!editingCategory ? (
            // Template List View
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <p className="text-zinc-400">{getCategoryNames(contentBanks).length} templates</p>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={async () => {
                      if (
                        confirm(
                          'Reset all templates to defaults? This will overwrite your custom templates.',
                        )
                      ) {
                        try {
                          await resetToDefaults(db, currentArtistId);
                          showToast('Templates reset to defaults', 'success');
                        } catch (error) {
                          showToast('Failed to reset templates', 'error');
                        }
                      }
                    }}
                    className="flex-1 sm:flex-none px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => {
                      setEditingCategory('__new__');
                      setTemplateForm({
                        name: '',
                        hashtagsAlways: '',
                        hashtagsPool: '',
                        captionsAlways: '',
                        captionsPool: '',
                      });
                    }}
                    className="flex-1 sm:flex-none px-4 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition"
                  >
                    + Add
                  </button>
                </div>
              </div>

              <div className="grid gap-3">
                {getCategoryNames(contentBanks).map((category) => {
                  const template = contentBanks[category];
                  return (
                    <div
                      key={category}
                      className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 hover:bg-zinc-800 transition"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg">{category}</h3>
                          <div className="mt-2 space-y-1">
                            <p className="text-sm text-zinc-400">
                              <span className="text-purple-400">
                                {(template.hashtags?.always?.length || 0) +
                                  (template.hashtags?.pool?.length || 0)}
                              </span>{' '}
                              hashtags
                              <span className="mx-2 text-zinc-600">•</span>
                              <span className="text-purple-400">
                                {(template.captions?.always?.length || 0) +
                                  (template.captions?.pool?.length || 0)}
                              </span>{' '}
                              caption phrases
                            </p>
                            <p className="text-xs text-zinc-500 truncate max-w-md">
                              {(template.hashtags?.always || [])
                                .concat(template.hashtags?.pool || [])
                                .slice(0, 5)
                                .join(' ')}
                              ...
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingCategory(category);
                              setTemplateForm({
                                name: category,
                                hashtagsAlways: (template.hashtags?.always || []).join(', '),
                                hashtagsPool: (template.hashtags?.pool || []).join(', '),
                                captionsAlways: (template.captions?.always || []).join(', '),
                                captionsPool: (template.captions?.pool || []).join(', '),
                              });
                            }}
                            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm(`Delete "${category}" template?`)) {
                                try {
                                  await deleteCategory(db, currentArtistId, category);
                                  showToast('Template deleted', 'success');
                                } catch (error) {
                                  showToast('Failed to delete template', 'error');
                                }
                              }
                            }}
                            className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // Edit/Add Template View
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditingCategory(null)}
                  className="text-zinc-400 hover:text-white"
                >
                  ← Back
                </button>
                <h3 className="text-lg font-semibold">
                  {editingCategory === '__new__' ? 'Add New Template' : `Edit: ${editingCategory}`}
                </h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Template Name / Niche
                  </label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500"
                    placeholder="e.g., Fashion, EDM, Runway"
                    disabled={editingCategory !== '__new__'}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Always-Use Hashtags
                      <span className="text-zinc-600 font-normal ml-2">included in every post</span>
                    </label>
                    <textarea
                      value={templateForm.hashtagsAlways}
                      onChange={(e) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          hashtagsAlways: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none font-mono text-sm"
                      placeholder="#fashion, #style, #aesthetic"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Hashtag Pool
                      <span className="text-zinc-600 font-normal ml-2">randomly selected</span>
                    </label>
                    <textarea
                      value={templateForm.hashtagsPool}
                      onChange={(e) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          hashtagsPool: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none font-mono text-sm"
                      placeholder="#ootd, #archive, #vibes, #mood"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Always-Use Caption Words
                      <span className="text-zinc-600 font-normal ml-2">included in every post</span>
                    </label>
                    <textarea
                      value={templateForm.captionsAlways}
                      onChange={(e) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          captionsAlways: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none"
                      placeholder="mood, vibe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Caption Pool
                      <span className="text-zinc-600 font-normal ml-2">randomly selected</span>
                    </label>
                    <textarea
                      value={templateForm.captionsPool}
                      onChange={(e) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          captionsPool: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 h-24 resize-none"
                      placeholder="forever, dreaming, ✨, archive, aesthetic"
                    />
                  </div>
                </div>

                <div className="bg-zinc-800/50 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-2">Preview</h4>
                  <p className="text-sm text-zinc-300">
                    {(() => {
                      const preview = generateFromTemplate(
                        {
                          hashtags: {
                            always: templateForm.hashtagsAlways
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                            pool: templateForm.hashtagsPool
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          },
                          captions: {
                            always: templateForm.captionsAlways
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                            pool: templateForm.captionsPool
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          },
                        },
                        'tiktok',
                      );
                      return preview.combined || 'Add some hashtags and captions to see a preview';
                    })()}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingCategory(null)}
                  className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-semibold hover:bg-zinc-700 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const categoryName =
                      editingCategory === '__new__' ? templateForm.name.trim() : editingCategory;
                    // BUG-023: Validate category name -- non-empty and max 50 chars
                    if (!categoryName) {
                      showToast('Please enter a template name', 'error');
                      return;
                    }
                    if (categoryName.length > 50) {
                      showToast('Template name must be 50 characters or less', 'error');
                      return;
                    }

                    setSavingTemplate(true);
                    try {
                      const template = {
                        hashtags: {
                          always: templateForm.hashtagsAlways
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                          pool: templateForm.hashtagsPool
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                        },
                        captions: {
                          always: templateForm.captionsAlways
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                          pool: templateForm.captionsPool
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                        },
                      };

                      await saveCategory(db, currentArtistId, categoryName, template);
                      showToast(`Template "${categoryName}" saved!`, 'success');
                      setEditingCategory(null);
                    } catch (error) {
                      log.error('Error saving template:', error);
                      showToast('Failed to save template', 'error');
                    } finally {
                      setSavingTemplate(false);
                    }
                  }}
                  disabled={savingTemplate}
                  className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-500 transition disabled:opacity-50"
                >
                  {savingTemplate ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
