import React, { useState, useCallback } from 'react';
import { FeatherChevronDown } from '@subframe/core';

/**
 * useCollapsibleSections — shared hook for collapsible sidebar sections.
 * Returns { openSections, toggleSection, renderCollapsibleSection }.
 *
 * @param {Object} initialSections — e.g. { audio: true, clips: true, lyrics: false }
 */
const useCollapsibleSections = (initialSections = {}) => {
  const [openSections, setOpenSections] = useState(initialSections);

  const toggleSection = useCallback((key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const renderCollapsibleSection = (key, title, content) => (
    <div className="w-full border-t border-neutral-200">
      <button
        onClick={() => toggleSection(key)}
        className="w-full flex items-center justify-between px-4 py-3 bg-transparent border-none text-white text-heading-3 font-heading-3 cursor-pointer"
      >
        <span>{title}</span>
        <FeatherChevronDown
          className={`w-4 h-4 text-neutral-500 flex-shrink-0 transition-transform duration-150 ${openSections[key] ? 'rotate-180' : ''}`}
        />
      </button>
      {openSections[key] && <div className="px-4 pb-4">{content}</div>}
    </div>
  );

  return { openSections, toggleSection, renderCollapsibleSection };
};

export default useCollapsibleSections;
