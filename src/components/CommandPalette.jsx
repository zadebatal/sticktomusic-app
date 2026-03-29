import React, { useEffect } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * CommandPalette — Cmd+K quick navigation using cmdk library.
 * Receives navigation items as props from App.jsx.
 */
const CommandPalette = ({ isOpen, onClose, items = [] }) => {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Group items by category
  const groups = {};
  items.forEach((item) => {
    const cat = item.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black/80 flex items-start justify-center pt-[20vh] z-[60] p-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          <motion.div
            className="w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            transition={{ duration: 0.12 }}
          >
            <Command
              className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden"
              label="Quick navigation"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
                <span className="text-zinc-500 text-sm">&#x1F50D;</span>
                <Command.Input
                  placeholder="Type a command or search..."
                  className="flex-1 bg-transparent text-lg text-white placeholder-zinc-500 focus:outline-none"
                  autoFocus
                />
                <kbd className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded text-xs">esc</kbd>
              </div>

              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-4 py-6 text-sm text-zinc-500 text-center">
                  No results found.
                </Command.Empty>

                {Object.entries(groups).map(([category, categoryItems]) => (
                  <Command.Group
                    key={category}
                    heading={category}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                  >
                    {categoryItems.map((item) => (
                      <Command.Item
                        key={item.label}
                        value={item.label}
                        onSelect={() => {
                          item.action();
                          onClose();
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-white transition-colors"
                      >
                        <span className="w-6 text-center flex-shrink-0">{item.icon}</span>
                        <span className="text-sm flex-1">{item.label}</span>
                        {item.shortcut && (
                          <kbd className="text-xs text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
                            {item.shortcut}
                          </kbd>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>

              <div className="p-2.5 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-600">
                <div className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded">↑↓</kbd>
                  <span>navigate</span>
                  <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded ml-2">↵</kbd>
                  <span>select</span>
                </div>
                <div>
                  <kbd className="px-1 py-0.5 bg-zinc-800 rounded">⌘</kbd>
                  {' + '}
                  <kbd className="px-1 py-0.5 bg-zinc-800 rounded">K</kbd>
                </div>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CommandPalette;
