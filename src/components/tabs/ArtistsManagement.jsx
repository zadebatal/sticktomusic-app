import React, { useState, useMemo } from 'react';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Badge } from '../../ui/components/Badge';
import { TextField } from '../../ui/components/TextField';
import { DropdownMenu } from '../../ui/components/DropdownMenu';
import {
  FeatherPlus, FeatherEdit, FeatherMoreVertical,
  FeatherTrash, FeatherSettings, FeatherSearch,
  FeatherFilter, FeatherCheck, FeatherX, FeatherUsers,
  FeatherLoader,
} from '@subframe/core';
import { Avatar } from '../../ui/components/Avatar';
import * as SubframeCore from '@subframe/core';

/**
 * ArtistsManagement — Dedicated artists grid view for conductor/operator roles.
 * Replaces inline artists tab in App.jsx.
 */

const ArtistsManagement = ({
  artists = [],
  user,
  currentArtistId,
  onArtistChange,
  onAddArtist,
  onEditArtist,
  onReassignArtist,
  onDeleteArtist,
  isConductor = false,
  latePages = [],
  loadingLatePages = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');

  // Determine Late.co connection status per artist
  const artistLateStatus = useMemo(() => {
    const map = {};
    artists.forEach(a => {
      map[a.id] = latePages.some(p => p.artistId === a.id);
    });
    return map;
  }, [artists, latePages]);

  // Get tier badge variant
  const getTierBadge = (artist) => {
    const tier = artist.subscriptionTier || artist.tier || 'starter';
    switch (tier.toLowerCase()) {
      case 'growth': return { variant: 'brand', label: 'Growth' };
      case 'scale': return { variant: 'warning', label: 'Scale' };
      case 'sensation': return { variant: 'success', label: 'Sensation' };
      default: return { variant: 'neutral', label: 'Starter' };
    }
  };

  // Filter artists
  const filteredArtists = useMemo(() => {
    let result = artists;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => a.name?.toLowerCase().includes(q));
    }
    if (tierFilter !== 'all') {
      result = result.filter(a => {
        const tier = (a.subscriptionTier || a.tier || 'starter').toLowerCase();
        return tier === tierFilter;
      });
    }
    return result;
  }, [artists, searchQuery, tierFilter]);

  // Social sets count per artist — count actual connected pages, not the quota
  const getSocialSetsCount = (artist) => {
    const artistPages = latePages.filter(p => p.artistId === artist.id);
    const handles = new Set(artistPages.map(p => p.handle).filter(Boolean));
    return handles.size;
  };

  return (
    <div className="flex-1 overflow-auto bg-black px-12 py-8">
      <div className="flex w-full flex-col items-start gap-8">

        {/* ═══ HEADER ═══ */}
        <div className="flex w-full items-center justify-between">
          <div className="flex flex-col items-start gap-2">
            <span className="text-heading-1 font-heading-1 text-[#ffffffff]">Artists</span>
            <span className="text-body font-body text-neutral-400">
              Manage all artists and their accounts
            </span>
          </div>
          {onAddArtist && (
            <Button
              variant="brand-primary"
              size="large"
              icon={<FeatherPlus />}
              onClick={onAddArtist}
            >
              Add Artist
            </Button>
          )}
        </div>

        {/* ═══ SEARCH + FILTER ═══ */}
        <div className="flex w-full items-center gap-3">
          <TextField className="grow shrink-0 basis-0" variant="filled" label="" helpText="">
            <TextField.Input
              placeholder="Search artists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </TextField>
          <SubframeCore.DropdownMenu.Root>
            <SubframeCore.DropdownMenu.Trigger asChild>
              <Button variant="neutral-secondary" icon={<FeatherFilter />}>
                {tierFilter === 'all' ? 'Filter by tier' : tierFilter.charAt(0).toUpperCase() + tierFilter.slice(1)}
              </Button>
            </SubframeCore.DropdownMenu.Trigger>
            <SubframeCore.DropdownMenu.Portal>
              <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
                <DropdownMenu>
                  <DropdownMenu.DropdownItem onClick={() => setTierFilter('all')}>
                    All Tiers
                  </DropdownMenu.DropdownItem>
                  <DropdownMenu.DropdownDivider />
                  <DropdownMenu.DropdownItem onClick={() => setTierFilter('starter')}>
                    Starter
                  </DropdownMenu.DropdownItem>
                  <DropdownMenu.DropdownItem onClick={() => setTierFilter('growth')}>
                    Growth
                  </DropdownMenu.DropdownItem>
                  <DropdownMenu.DropdownItem onClick={() => setTierFilter('scale')}>
                    Scale
                  </DropdownMenu.DropdownItem>
                  <DropdownMenu.DropdownItem onClick={() => setTierFilter('sensation')}>
                    Sensation
                  </DropdownMenu.DropdownItem>
                </DropdownMenu>
              </SubframeCore.DropdownMenu.Content>
            </SubframeCore.DropdownMenu.Portal>
          </SubframeCore.DropdownMenu.Root>
        </div>

        {/* ═══ ARTIST CARDS GRID ═══ */}
        {filteredArtists.length === 0 ? (
          <div className="flex w-full flex-col items-center gap-4 py-16">
            <FeatherUsers className="text-neutral-600" style={{ width: 48, height: 48 }} />
            <span className="text-heading-3 font-heading-3 text-[#ffffffff]">
              {searchQuery || tierFilter !== 'all' ? 'No matching artists' : 'No artists yet'}
            </span>
            <span className="text-body font-body text-neutral-400">
              {searchQuery || tierFilter !== 'all'
                ? 'Try adjusting your search or filter.'
                : 'Add your first artist to get started with content creation.'}
            </span>
            {!searchQuery && tierFilter === 'all' && onAddArtist && (
              <Button variant="brand-primary" size="medium" icon={<FeatherPlus />} onClick={onAddArtist}>
                Add Artist
              </Button>
            )}
          </div>
        ) : (
          <div className="grid w-full grid-cols-1 sm:grid-cols-2 gap-6">
            {filteredArtists.map(artist => {
              const tier = getTierBadge(artist);
              const isActive = artist.status === 'active' || !artist.status;
              const isConnected = artistLateStatus[artist.id];
              const isSelected = currentArtistId === artist.id;

              return (
                <div
                  key={artist.id}
                  className={`flex grow shrink-0 basis-0 flex-col items-start gap-6 rounded-lg border border-solid px-6 py-6 bg-[#1a1a1aff] cursor-pointer transition-colors ${
                    isSelected ? 'border-brand-600' : 'border-neutral-200 hover:border-neutral-200'
                  }`}
                  onClick={() => onArtistChange?.(artist.id)}
                >
                  {/* Row 1: Identity */}
                  <div className="flex w-full items-start gap-4">
                    <Avatar
                      size="large"
                      image={artist.photoURL || undefined}
                      className="flex-none"
                    >
                      {(artist.name || '?')[0].toUpperCase()}
                    </Avatar>
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                      <span className="text-heading-3 font-heading-3 text-[#ffffffff]">{artist.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={tier.variant}>{tier.label}</Badge>
                        {isActive ? (
                          <div className="flex items-center gap-1">
                            <FeatherCheck className="text-body font-body text-[#22c55eff]" />
                            <span className="text-caption font-caption text-neutral-400">Active</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-neutral-400" />
                            <span className="text-caption font-caption text-neutral-400">Inactive</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Kebab menu */}
                    <SubframeCore.DropdownMenu.Root>
                      <SubframeCore.DropdownMenu.Trigger asChild>
                        <IconButton
                          variant="neutral-tertiary"
                          size="small"
                          icon={<FeatherMoreVertical />}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="More options"
                        />
                      </SubframeCore.DropdownMenu.Trigger>
                      <SubframeCore.DropdownMenu.Portal>
                        <SubframeCore.DropdownMenu.Content side="bottom" align="end" sideOffset={4} asChild>
                          <DropdownMenu>
                            <DropdownMenu.DropdownItem
                              icon={<FeatherEdit />}
                              onClick={(e) => { e.stopPropagation(); onEditArtist?.(artist); }}
                            >
                              Edit Artist
                            </DropdownMenu.DropdownItem>
                            <DropdownMenu.DropdownItem
                              icon={<FeatherSettings />}
                              onClick={(e) => { e.stopPropagation(); onArtistChange?.(artist.id); }}
                            >
                              Manage Pages
                            </DropdownMenu.DropdownItem>
                            {isConductor && (
                              <>
                                <DropdownMenu.DropdownDivider />
                                <DropdownMenu.DropdownItem
                                  icon={<FeatherTrash />}
                                  onClick={(e) => { e.stopPropagation(); onDeleteArtist?.(artist); }}
                                >
                                  Remove Artist
                                </DropdownMenu.DropdownItem>
                              </>
                            )}
                          </DropdownMenu>
                        </SubframeCore.DropdownMenu.Content>
                      </SubframeCore.DropdownMenu.Portal>
                    </SubframeCore.DropdownMenu.Root>
                  </div>

                  {/* Row 2: Stats */}
                  <div className="flex w-full items-center justify-between">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-caption font-caption text-neutral-400">Social Sets</span>
                      <span className="text-body-bold font-body-bold text-[#ffffffff]">
                        {getSocialSetsCount(artist)} Sets
                      </span>
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-caption font-caption text-neutral-400">Late.co Status</span>
                      <div className="flex items-center gap-1">
                        {loadingLatePages ? (
                          <>
                            <FeatherLoader className="text-body font-body text-neutral-400 animate-spin" style={{ width: 14, height: 14 }} />
                            <span className="text-body-bold font-body-bold text-neutral-400">Checking...</span>
                          </>
                        ) : isConnected ? (
                          <>
                            <FeatherCheck className="text-body font-body text-[#22c55eff]" />
                            <span className="text-body-bold font-body-bold text-[#ffffffff]">Connected</span>
                          </>
                        ) : (
                          <>
                            <FeatherX className="text-body font-body text-neutral-400" />
                            <span className="text-body-bold font-body-bold text-[#ffffffff]">Not Connected</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Action */}
                  <Button
                    className="h-10 w-full"
                    variant="neutral-secondary"
                    size="large"
                    onClick={(e) => { e.stopPropagation(); onArtistChange?.(artist.id); }}
                  >
                    View Details
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtistsManagement;
